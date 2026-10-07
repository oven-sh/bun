//! Prints types, symbols and signatures as TypeScript does in messages.
//!
//! A port of the behavior of `typeToString`, `symbolToString` and `signatureToString` in
//! `nodebuilderimpl.go` and the printer. There the node builder creates syntax from a type and the
//! printer emits the syntax. Here a [`Node`] is the text of a type node, with the precedence the
//! printer uses to parenthesize it.

use super::enclosing_declaration::Enclosing;
use super::errors_declaration_emit::{EndOfChain, Meaning};

use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, ScopeId, ScopeKind, SymbolId};
use crate::resolve::{displayed_path, remove_file_extension};
use bun_core::fmt::{ItoaBuf, VecWriter, digit_count, itoa};
use bun_core::lexer::is_identifier;
use bun_core::strings::{CodepointIterator, Cursor};
use core::fmt::Write;
use std::ops::ControlFlow;

#[path = "print_node_reuse.rs"]
mod node_reuse;

/// `nodebuilder.Flags`, those that change what is printed or reported.
const NO_TRUNCATION: u32 = 1 << 0;
pub(super) const USE_FULLY_QUALIFIED_TYPE: u32 = 1 << 1;
const ALLOW_UNIQUE_ES_SYMBOL_TYPE: u32 = 1 << 2;
pub(super) const USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE: u32 = 1 << 3;
pub(super) const NO_TYPE_REDUCTION: u32 = 1 << 4;
const GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS: u32 = 1 << 5;
const IN_OBJECT_TYPE_LITERAL: u32 = 1 << 6;
const ALLOW_ANONYMOUS_IDENTIFIER: u32 = 1 << 7;
const ALLOW_NODE_MODULES_RELATIVE_PATHS: u32 = 1 << 8;
const ALLOW_THIS_IN_OBJECT_LITERAL: u32 = 1 << 9;
pub(super) const WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL: u32 = 1 << 10;
const USE_TYPE_OF_FUNCTION: u32 = 1 << 11;
const USE_STRUCTURAL_FALLBACK: u32 = 1 << 12;
const MULTILINE_OBJECT_LITERALS: u32 = 1 << 13;
const FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES: u32 = 1 << 14;
pub(super) const WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME: u32 = 1 << 15;
/// What `typeToString` hands `typeToStringEx`.
pub(super) const TYPE_TO_STRING: u32 =
    ALLOW_UNIQUE_ES_SYMBOL_TYPE | USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE;
/// `declarationEmitNodeBuilderFlags`
pub(super) const DECLARATION_EMIT_NODE_BUILDER_FLAGS: u32 = WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL
    | USE_TYPE_OF_FUNCTION
    | USE_STRUCTURAL_FALLBACK
    | GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS
    | MULTILINE_OBJECT_LITERALS
    | NO_TRUNCATION;
/// `FlagsIgnoreErrors`, which `typeToStringEx`, `symbolToStringEx` and `signatureToStringEx` add.
pub(super) const IGNORE_ERRORS: u32 =
    ALLOW_ANONYMOUS_IDENTIFIER | ALLOW_NODE_MODULES_RELATIVE_PATHS | ALLOW_THIS_IN_OBJECT_LITERAL;
const DEFAULT_MAXIMUM_TRUNCATION_LENGTH: usize = 160;
const NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH: usize = 1_000_000;
/// `any` with the synthetic leading comment of `createElidedInformationPlaceholder`.
const ELIDED: &[u8] = b"/*elided*/ any";

/// Maximum nesting depth for printing types of any kind. TypeScript has no such limit.
const MAXIMUM_DEPTH: u32 = 150;

/// `ast.TypePrecedence`
const CONDITIONAL: u8 = 0;
const FUNCTION: u8 = 2;
const UNION: u8 = 3;
const INTERSECTION: u8 = 4;
const TYPE_OPERATOR: u8 = 5;
const POSTFIX: u8 = 6;
const NON_ARRAY: u8 = 7;

impl Checker<'_, '_> {
    /// `DeclarationNameToString(GetNonAssignedNameOfDeclaration(e))` for an assignment or a call
    /// that declares a property.
    pub(super) fn name_of_assignment_declaration(
        &self,
        file: FileId,
        e: ExprId,
    ) -> Option<Vec<u8>> {
        let hir = self.hir(file);
        let name = match hir[e].kind {
            // `module.exports = value` has no name.
            ExprKind::Assign { .. }
                if crate::bind::assignment_declaration_kind(hir, e)
                    == crate::bind::JsDeclarationKind::ModuleExports =>
            {
                return None;
            }
            // `GetElementOrPropertyAccessName`, or else the whole left-hand side.
            ExprKind::Assign { target, .. } => match hir[target].kind {
                ExprKind::Dot { name, name_pos, .. } if !is_private_name_at(hir, name_pos) => {
                    return Some(self.atom_text(name));
                }
                ExprKind::Index { index, .. } if is_string_or_numeric_literal_like(hir, index) => {
                    index
                }
                _ => target,
            },
            _ => crate::bind::define_property_call(hir, e)?.1,
        };
        Some(self.source_text(
            file,
            self.start_inside_parentheses(file, name),
            self.end_inside_parentheses(file, name),
        ))
    }

    /// `typeToStringEx(t, nil, flags)`
    pub(super) fn write_type(&mut self, out: &mut Vec<u8>, ty: TypeId, flags: u32) {
        out.append(&mut type_to_string_with(self, ty, None, flags));
    }

    /// What `write` writes.
    fn printed(&mut self, write: impl FnOnce(&mut Self, &mut Vec<u8>)) -> Vec<u8> {
        let mut out = Vec::new();
        write(self, &mut out);
        out
    }

    /// `typeToStringEx` when and where tsgo prints `ty` for a message, for its resolution side
    /// effects: it counts as a level, and cycles are detected through it.
    pub(super) fn resolve_by_printing(&mut self, ty: TypeId) {
        self.type_to_string(ty);
    }

    /// `typeToString`
    pub fn type_to_string(&mut self, ty: TypeId) -> Vec<u8> {
        self.printed(|c, out| c.write_type(out, ty, TYPE_TO_STRING))
    }

    /// `TypeToTypeNode` with the flags of `typeWriterWalker.writeTypeOrSymbol`.
    #[cfg(feature = "baselines")]
    pub(super) fn type_to_string_for_baseline_with(
        &mut self,
        ty: TypeId,
        enclosing_declaration: Option<Enclosing>,
    ) -> Vec<u8> {
        // `writeTypeOrSymbol` does not query the node builder about it in a test without errors.
        if ty == TypeId::ERROR {
            return super::type_writer::ERROR_TYPE_TEXT.as_bytes().to_vec();
        }
        let flags = NO_TRUNCATION
            | ALLOW_UNIQUE_ES_SYMBOL_TYPE
            | GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS
            | IGNORE_ERRORS;
        to_valid_utf8(self.type_to_type_node(ty, enclosing_declaration, flags, None))
    }

    /// `getTypeNameForErrorDisplay`
    pub fn type_to_string_fully_qualified(&mut self, ty: TypeId) -> Vec<u8> {
        self.printed(|c, out| c.write_type(out, ty, USE_FULLY_QUALIFIED_TYPE))
    }

    /// `typeToStringEx(t, nil, TypeFormatFlagsNoTypeReduction)`: an intersection that reduces to
    /// `never` is printed in full, not as `never`.
    pub fn type_to_string_without_reduction(&mut self, ty: TypeId) -> Vec<u8> {
        self.printed(|c, out| c.write_type(out, ty, NO_TYPE_REDUCTION))
    }

    /// `t.symbol.ValueDeclaration`, if that is an expression (`ast.IsExpression`), and the scope
    /// from which names are resolved there.
    fn value_declaration_expression_of_type(
        &self,
        ty: TypeId,
    ) -> Option<(FileId, ExprId, ScopeId)> {
        match *self.data(ty) {
            TypeData::Fns { ref decls, .. } => {
                let [(file, func)] = decls[..] else {
                    return None;
                };
                let FnOwner::Expr(e) = self.bound(file).fns[func.idx()].owner else {
                    return None;
                };
                if !matches!(self.hir(file)[func].kind, FnKind::Expr | FnKind::Arrow) {
                    return None;
                }
                let scope = self.enclosing_scope_of_declaration(file, Decl::Fn(func));
                Some((file, e, scope))
            }
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..),
                ..
            } => matches!(self.hir(file)[e].kind, ExprKind::Object(_))
                .then(|| (file, e, self.enclosing_scope_of_expr(file, e))),
            TypeData::Synth(ref shape) => {
                let (file, _, e) = shape.symbol_declared_at.filter(|it| it.2.is_some())?;
                Some((file, e, self.enclosing_scope_of_expr(file, e)))
            }
            TypeData::Anon {
                origin: Origin::ClassStatic(class),
                ..
            }
            | TypeData::Ref { target: class, .. } => {
                let decls = self.files().decls_of(class);
                let &(file, Decl::Class(c)) = decls.first()? else {
                    return None;
                };
                let ClassOwner::Expr(e) = self.bound(file).class_owner[c.idx()] else {
                    return None;
                };
                let scope = self.enclosing_scope_of_declaration(file, Decl::Class(c));
                Some((file, e, scope))
            }
            _ => None,
        }
    }

    /// `typeToString(t, t.symbol.ValueDeclaration)` if `symbolValueDeclarationIsContextSensitive`,
    /// which returns the opposite of what its name suggests. Otherwise `typeToString(t)`.
    fn type_to_string_at_value_declaration(&mut self, ty: TypeId) -> Vec<u8> {
        let enclosing_declaration = self
            .value_declaration_expression_of_type(ty)
            .filter(|&(file, e, _)| !self.is_context_sensitive(file, e))
            .map(|(file, e, scope)| (Enclosing::at_scope(file, scope), e));
        type_to_string_with(self, ty, enclosing_declaration, TYPE_TO_STRING)
    }

    /// `getTypeNamesForErrorDisplay`: both names, qualified if they would otherwise be identical.
    pub fn type_names_for_error_display(
        &mut self,
        left: TypeId,
        right: TypeId,
    ) -> (Vec<u8>, Vec<u8>) {
        let (left_text, right_text) = (
            self.type_to_string_at_value_declaration(left),
            self.type_to_string_at_value_declaration(right),
        );
        if left_text != right_text {
            return (left_text, right_text);
        }
        (
            self.type_to_string_fully_qualified(left),
            self.type_to_string_fully_qualified(right),
        )
    }

    /// `symbolToString`
    pub(super) fn write_symbol(&mut self, out: &mut Vec<u8>, symbol: Sym) {
        out.append(&mut with_printer(self, None, None, IGNORE_ERRORS, |p| {
            p.symbol_to_text(symbol)
        }));
    }

    /// `symbolToString`
    pub fn symbol_to_string(&mut self, symbol: Sym) -> Vec<u8> {
        self.printed(|c, out| c.write_symbol(out, symbol))
    }

    /// `getSpecifierForModuleSymbol` without an enclosing file: the name of the symbol without its quotes.
    pub(super) fn specifier_of_module(&self, symbol: Sym) -> Vec<u8> {
        let files = self.files();
        let decls = files.decls(symbol);
        if let Some(&(file, _)) = decls.iter().find(|d| d.1 == Decl::File) {
            let file_name = displayed_path(files.module(file).file_name());
            return remove_file_extension(&file_name).to_owned();
        }
        let ambient_name = |&(file, decl): &(FileId, Decl)| match decl {
            Decl::Module(m) => match self.hir(file)[m].name {
                ModuleName::String(name) => Some(name),
                _ => None,
            },
            _ => None,
        };
        // `GetSourceFileOfModule(symbol).FileName()`: what `export =` names, with what
        // `declare module "m"` adds to the module (`getCommonJSExportEquals`), has its own name.
        if let Some(&(file, _)) = decls.iter().find(|it| ambient_name(it).is_none()) {
            return displayed_path(files.module(file).file_name()).into_owned();
        }
        match decls.iter().find_map(ambient_name) {
            Some(name) => self.atom_text(name),
            None => Vec::new(),
        }
    }

    /// `symbol.Parent` of the member `m`, if a class or an interface declares it.
    #[cfg(feature = "baselines")]
    pub(super) fn symbol_of_member_owner(&self, file: FileId, m: MemberId) -> Option<Sym> {
        let bound = self.bound(file);
        let container = match bound.member_owner[m.idx()] {
            MemberOwner::Class(class) => bound.class_symbol[class.idx()],
            MemberOwner::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => return None,
        };
        container
            .is_some()
            .then(|| self.files().sym(file, container))
    }

    /// `symbolToStringEx` with `SymbolFormatFlagsDoNotIncludeSymbolChain`
    pub(super) fn symbol_to_string_at(&mut self, symbol: Sym, at: Option<Enclosing>) -> Vec<u8> {
        with_printer(self, at, None, IGNORE_ERRORS, |p| p.symbol_to_text(symbol))
    }

    /// `getNameOfSymbolAsWritten` for the symbol of the function expression or arrow function `e`,
    /// which has no `Sym`.
    #[cfg(feature = "baselines")]
    pub(super) fn name_of_function_expression(&mut self, file: FileId, e: ExprId) -> Vec<u8> {
        to_valid_utf8(with_printer(self, None, None, 0, |printer| {
            printer
                .name_of_initialized_variable(file, e)
                .unwrap_or_else(|| b"(Anonymous function)".to_vec())
        }))
    }

    /// `getNameOfSymbolAsWritten` for the `__object` symbol of an object literal: the name of the variable it initializes, else `__object`.
    pub(super) fn name_of_object_literal(&self, file: FileId, e: ExprId) -> Vec<u8> {
        match self.bound(file).expr_parent[e.idx()] {
            Parent::VarInit(declaration) if !is_parenthesized(self.hir(file), e) => {
                self.declaration_name_of_variable(file, self.hir(file)[declaration].pat)
            }
            _ => b"__object".to_vec(),
        }
    }

    /// `getNameOfSymbolAsWritten` for the `__type` symbol of a type literal: the name of the variable it annotates, else `__type`.
    pub(super) fn name_of_type_literal(&self, file: FileId, node: TypeNodeId) -> Vec<u8> {
        let mut declarations = self.hir(file).var_decls.iter();
        match declarations.find(|declaration| declaration.ty == node) {
            Some(declaration) => self.declaration_name_of_variable(file, declaration.pat),
            None => b"__type".to_vec(),
        }
    }

    /// `DeclarationNameToString` of a variable's name. An identifier is read from the atom table: default library files do not retain their text.
    fn declaration_name_of_variable(&self, file: FileId, pat: PatId) -> Vec<u8> {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Ident(name) => self.atoms().bytes(name).to_vec(),
            _ => hir.text[hir[pat].pos as usize..self.end_of_pat(file, pat) as usize].to_vec(),
        }
    }

    /// `symbolToString` for a property.
    pub(super) fn write_prop(&mut self, out: &mut Vec<u8>, prop: &Prop) {
        let mut text = with_printer(self, None, None, IGNORE_ERRORS, |printer| {
            printer.name_of_property_as_written(prop)
        });
        out.append(&mut text);
    }

    /// `symbolToString` for a property.
    pub fn prop_to_string(&mut self, prop: &Prop) -> Vec<u8> {
        self.printed(|c, out| c.write_prop(out, prop))
    }

    /// `signatureToString`. It is truncated regardless of `noErrorTruncation`.
    pub(super) fn write_signature(&mut self, out: &mut Vec<u8>, signature: SigId) {
        let kind = match *self.types().sig(self.types().sig_origin(signature)) {
            SigData::Construct { .. } | SigData::DefaultConstruct { .. } => {
                SignatureKind::Construct
            }
            SigData::Decl { file, func, .. }
                if matches!(
                    self.hir(file)[func].kind,
                    FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType
                ) =>
            {
                SignatureKind::Construct
            }
            _ => SignatureKind::Call,
        };
        let flags = IGNORE_ERRORS | WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME;
        let mut text = with_printer(self, None, None, flags, |printer| {
            printer.never_ascii_escape = true;
            printer.signature_to_text(signature, kind, b"", false)
        });
        out.append(&mut text);
    }

    /// `t.alias`, as far as it can be determined: the type alias `type_to_string` prints `ty` as.
    /// `None`: it expands `ty`.
    pub fn alias_for_display(&mut self, ty: TypeId) -> Option<Sym> {
        self.alias_symbol_of_type(ty)
    }

    /// `c.varianceTypeParameter = parameter`: the type parameter that `sub-T` and `super-T` are
    /// named after, while the error for a variance annotation is being formatted.
    pub fn set_variance_type_parameter(&mut self, parameter: Option<TypeId>) {
        let name = parameter
            .and_then(|parameter| self.type_param_name(parameter))
            .unwrap_or(Atom::NONE);
        self.variance_type_parameter = name;
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `NodeBuilder.SerializeTypeForDeclaration` for a declaration of `file`. `ty`:
    /// `getTypeOfSymbol(symbol)`. `declaration`: none if nothing is reused from its syntax.
    pub(super) fn serialize_type_for_declaration(
        &mut self,
        file: FileId,
        declaration: Option<hir::Node>,
        ty: TypeId,
        enclosing_declaration: Enclosing,
        flags: u32,
        tracker: &mut dyn SymbolTracker<'p>,
    ) -> Vec<u8> {
        let enclosing_declaration = Some(enclosing_declaration);
        with_printer(
            self,
            enclosing_declaration,
            Some(tracker),
            flags,
            |printer| {
                let ty = printer.c.widen_literal(ty);
                match declaration {
                    Some(declaration) => printer.serialize_type_for_declaration(
                        file,
                        declaration,
                        ty,
                        node_reuse::SerializeTypeOptions {
                            try_reuse: true,
                            is_optional_reverse_mapped: false,
                        },
                    ),
                    None => printer.type_to_node(ty),
                }
                .text
            },
        )
    }

    /// `NodeBuilder.SerializeReturnTypeForSignature`
    pub(super) fn serialize_return_type_for_signature(
        &mut self,
        file: FileId,
        signature_declaration: FnId,
        enclosing_declaration: Enclosing,
        flags: u32,
        tracker: &mut dyn SymbolTracker<'p>,
    ) -> Vec<u8> {
        let signature = self.sig_of_declaration(file, signature_declaration);
        let enclosing_declaration = Some(enclosing_declaration);
        with_printer(
            self,
            enclosing_declaration,
            Some(tracker),
            flags,
            |printer| printer.serialize_return_type_for_signature(signature).text,
        )
    }

    /// `NodeBuilder.SerializeTypeParametersForSignature` for a function with a `FullSignature`:
    /// `<A, B>`, or nothing.
    pub(super) fn serialize_type_parameters_for_signature(
        &mut self,
        file: FileId,
        signature_declaration: FnId,
        enclosing_declaration: Enclosing,
        flags: u32,
        tracker: &mut dyn SymbolTracker<'p>,
    ) -> Vec<u8> {
        // `getTypeParametersFromDeclaration`
        let type_parameters = match self.full_signature(file, signature_declaration) {
            Some(signature) => self.sig_type_params(signature).into_vec(),
            None => Vec::new(),
        };
        if type_parameters.is_empty() {
            return Vec::new();
        }
        let enclosing_declaration = Some(enclosing_declaration);
        with_printer(
            self,
            enclosing_declaration,
            Some(tracker),
            flags,
            |printer| {
                let mut declarations = Vec::with_capacity(type_parameters.len());
                for parameter in type_parameters {
                    declarations.push(printer.type_parameter_declaration(parameter, &[]));
                }
                cat!(b"<", declarations.join(&b", "[..]), b">")
            },
        )
    }

    /// `NodeBuilder.TypeToTypeNode`
    pub(super) fn type_to_type_node(
        &mut self,
        ty: TypeId,
        enclosing_declaration: Option<Enclosing>,
        flags: u32,
        tracker: Option<&mut dyn SymbolTracker<'p>>,
    ) -> Vec<u8> {
        with_printer(self, enclosing_declaration, tracker, flags, |printer| {
            printer.type_to_node(ty).text
        })
    }

    /// `NodeBuilder.SymbolToExpression(symbol, SymbolFlagsValue, enclosingDeclaration, FlagsNone)`,
    /// for a symbol that is already tracked.
    pub(super) fn symbol_to_expression(
        &mut self,
        symbol: Sym,
        enclosing_declaration: Enclosing,
    ) -> Vec<u8> {
        with_printer(self, Some(enclosing_declaration), None, 0, |printer| {
            printer.symbol_to_expression(symbol)
        })
    }

    /// `NodeBuilder.TryJSTypeNodeToTypeNode`
    pub(super) fn try_js_type_node_to_type_node(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        enclosing_declaration: Enclosing,
        flags: u32,
        tracker: &mut dyn SymbolTracker<'p>,
    ) -> Option<Vec<u8>> {
        let enclosing_declaration = Some(enclosing_declaration);
        with_printer(
            self,
            enclosing_declaration,
            Some(tracker),
            flags,
            |printer| {
                printer
                    .try_reuse_type_node(file, node)
                    .map(|node| node.text)
            },
        )
    }

    /// The printed text of `what`, a node of `file` that the declaration transformer reuses
    /// verbatim. The transformer has already visited it for anything that prevents reuse, so
    /// nothing is tracked.
    pub(super) fn text_of_reused_node(
        &mut self,
        file: FileId,
        what: Written,
        enclosing_declaration: Enclosing,
    ) -> Vec<u8> {
        let flags = DECLARATION_EMIT_NODE_BUILDER_FLAGS;
        with_printer(
            self,
            Some(enclosing_declaration),
            None,
            flags,
            |printer| match what {
                Written::Type(node) => {
                    printer.is_transformer = true;
                    printer.reuse_type_node(file, node).text
                }
                Written::TypeParameter(tp) => {
                    printer.is_transformer = true;
                    (printer.visit_type_parameter_declaration(file, tp)).unwrap_or_default()
                }
                Written::BindingName(pat) => {
                    printer.is_transformer = true;
                    printer.binding_name_text(file, pat)
                }
                Written::PropertyName(name) => printer.property_key_text(file, name),
                Written::EntityName(e) => printer.entity_name_text(file, e).unwrap_or_default(),
            },
        )
    }

    /// `NodeBuilder.SerializeTypeForExpression`
    pub(super) fn serialize_type_for_expression(
        &mut self,
        file: FileId,
        e: ExprId,
        enclosing_declaration: Enclosing,
        flags: u32,
        tracker: &mut dyn SymbolTracker<'p>,
    ) -> Vec<u8> {
        let ty = self.type_of_expr(file, e);
        let ty = self.regular(ty);
        let ty = self.widened(ty);
        let enclosing_declaration = Some(enclosing_declaration);
        with_printer(
            self,
            enclosing_declaration,
            Some(tracker),
            flags,
            |printer| printer.type_to_node(ty).text,
        )
    }
}

/// See `Checker::text_of_reused_node`.
#[derive(Copy, Clone)]
pub(super) enum Written {
    Type(TypeNodeId),
    TypeParameter(TypeParamId),
    /// `cloneBindingName`
    BindingName(PatId),
    PropertyName(hir::Node),
    /// `a.b.c`
    EntityName(ExprId),
}

/// `typeToStringEx`. `enclosing_declaration`: with the expression that it is.
fn type_to_string_with(
    checker: &mut Checker<'_, '_>,
    ty: TypeId,
    enclosing_declaration: Option<(Enclosing, ExprId)>,
    flags: u32,
) -> Vec<u8> {
    let counts = !checker.reprinting;
    if counts && checker.serialization_level >= super::sink::MAX_SERIALIZATION_LEVEL {
        return b"?".to_vec();
    }
    let no_truncation = checker.files().options.no_error_truncation;
    let flags = if no_truncation {
        flags | NO_TRUNCATION
    } else {
        flags
    } | IGNORE_ERRORS;
    checker.serialization_level += u32::from(counts);
    checker.printing_closes_cycles = counts;
    checker.printing_floors.push(checker.stack.len());
    let (enclosing_declaration, enclosing_expression) = enclosing_declaration.unzip();
    let text = with_printer(checker, enclosing_declaration, None, flags, |printer| {
        printer.enclosing_expression = enclosing_expression;
        printer.type_to_node(ty).text
    });
    checker.printing_floors.pop();
    checker.serialization_level -= u32::from(counts);
    let maximum = 2 * if no_truncation {
        NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH
    } else {
        DEFAULT_MAXIMUM_TRUNCATION_LENGTH
    };
    if text.len() < maximum {
        return text;
    }
    cat!(text[..maximum - b"...".len()], b"...")
}

/// `strings.ToValidUTF8(text, "\uFFFD")` for text that leaves the checker.
pub(super) fn to_valid_utf8(text: Vec<u8>) -> Vec<u8> {
    if std::str::from_utf8(&text).is_ok() {
        return text;
    }
    let mut valid = Vec::with_capacity(text.len());
    // Whether the previous byte was invalid: a run of them is replaced once.
    let mut invalid = false;
    for chunk in text.utf8_chunks() {
        if !chunk.valid().is_empty() {
            valid.extend_from_slice(chunk.valid().as_bytes());
            invalid = false;
        }
        if !chunk.invalid().is_empty() && !std::mem::replace(&mut invalid, true) {
            valid.extend_from_slice("\u{FFFD}".as_bytes());
        }
    }
    valid
}

/// Printing resolves the types it encounters. A cycle through here is not an error, and the state
/// of the check in progress is left unchanged.
fn with_printer<'p, T>(
    checker: &mut Checker<'p, '_>,
    enclosing_declaration: Option<Enclosing>,
    tracker: Option<&mut dyn SymbolTracker<'p>>,
    flags: u32,
    print: impl FnOnce(&mut Printer<'_, 'p, '_>) -> T,
) -> T {
    let saved = checker.relation_too_complex;
    let is_barrier = !std::mem::take(&mut checker.printing_closes_cycles);
    if is_barrier {
        checker.eager.push(checker.stack.len());
    }
    let indent = (checker.declaration_indent).filter(|_| flags & MULTILINE_OBJECT_LITERALS != 0);
    let result = {
        let mut printer = Printer {
            c: &mut *checker,
            flags,
            is_transformer: false,
            never_ascii_escape: false,
            indent,
            container_pos: usize::MAX,
            approximate_length: 0,
            truncating: false,
            visited_types: Vec::new(),
            symbol_depth: Vec::new(),
            infer_type_parameters: Vec::new(),
            reverse_mapped_stack: Vec::new(),
            mapper: MapperId::IDENTITY,
            enclosing_symbol_types: Vec::new(),
            depth: 0,
            enclosing_declaration,
            enclosing_expression: None,
            tracker: tracker.map(|tracker| tracker as &mut dyn SymbolTracker<'p>),
            boundaries: Vec::new(),
            suppress_report_inference_fallback: false,
            reported_diagnostic: false,
            encountered_error: false,
            tracked_symbols: Vec::new(),
            serialized_types: FxHashMap::default(),
            has_fake_scope: [false; 2],
            fake_scope_count: 0,
            type_parameter_names: Vec::new(),
            type_parameter_name_counts: Vec::new(),
            type_parameter_symbol_list: Vec::new(),
            fake_scope_type_parameters: Vec::new(),
            fake_scope_parameters: Vec::new(),
        };
        let result = print(&mut printer);
        printer.exit_context_check();
        result
    };
    if is_barrier {
        checker.eager.pop();
    }
    checker.relation_too_complex = saved;
    result
}

/// A type node as the printer emits it.
#[derive(Clone)]
struct Node {
    text: Vec<u8>,
    /// `GetTypeNodePrecedence`
    precedence: u8,
    /// `isIdentifierTypeReference`: the name of a type reference whose name is a single identifier.
    reference: Option<Vec<u8>>,
    /// `UnionTypeNode.Types`, each as it is emitted.
    types: Vec<Vec<u8>>,
    /// The text under `inExtends`, if that differs.
    in_extends: Option<Vec<u8>>,
}

impl Node {
    fn texts(&mut self) -> impl Iterator<Item = &mut Vec<u8>> {
        std::iter::once(&mut self.text)
            .chain(&mut self.types)
            .chain(&mut self.in_extends)
    }

    /// Re-indents text whose first line was at indentation level `from` to level `to`.
    fn indented(mut self, from: usize, to: usize) -> Node {
        let (old, new) = (
            [b"\n", &b"    ".repeat(from)[..]].concat(),
            [b"\n", &b"    ".repeat(to)[..]].concat(),
        );
        for text in self.texts() {
            if bun_core::strings::contains_char(text, b'\n') {
                *text = bun_core::strings::replace_owned(&text[..], &old, &new);
            }
        }
        self
    }

    /// `DeepCloneNode`: `emitNode.copyFrom` does not copy the synthetic comments.
    fn deep_clone(mut self) -> Node {
        for text in self.texts() {
            if bun_core::strings::contains(text, ELIDED) {
                *text = bun_core::strings::replace_owned(&text[..], ELIDED, b"any");
            }
        }
        self
    }

    fn new(text: impl Into<Vec<u8>>, precedence: u8) -> Node {
        Node {
            text: text.into(),
            precedence,
            reference: None,
            types: Vec::new(),
            in_extends: None,
        }
    }

    /// A function type or a constructor type. `head`: all that precedes its return type.
    fn function(head: &[u8], returned: Node) -> Node {
        // `emitReturnType`, `emitTypeNode`: in the `extends` clause of a conditional type, a
        // conditional type and an `infer` type with a constraint are parenthesized.
        let in_extends = if returned.precedence == CONDITIONAL
            || returned.precedence == FUNCTION && returned.text.starts_with(b"infer ")
        {
            Some(cat!(head, b"(", returned.text, b")"))
        } else {
            returned.in_extends.map(|returned| cat!(head, returned))
        };
        Node {
            in_extends,
            ..Node::new(cat!(head, returned.text), FUNCTION)
        }
    }

    /// `NewUnionTypeNode`
    fn union(types: Vec<Node>) -> Node {
        let types: Vec<Vec<u8>> = types
            .into_iter()
            .map(|node| node.emit(TYPE_OPERATOR))
            .collect();
        Node {
            text: types.join(&b" | "[..]),
            precedence: UNION,
            reference: None,
            types,
            in_extends: None,
        }
    }

    fn simple(text: impl Into<Vec<u8>>) -> Node {
        Node::new(text, NON_ARRAY)
    }

    /// `emitTypeNode(node, precedence)`
    fn emit(self, at_least: u8) -> Vec<u8> {
        if self.precedence < at_least {
            cat!(b"(", self.text, b")")
        } else {
            self.text
        }
    }

    /// `emitTypeNodeInExtends`
    fn emit_in_extends(mut self) -> Vec<u8> {
        if let Some(text) = self.in_extends.take() {
            self.text = text;
        }
        self.emit(FUNCTION)
    }
}

fn join_nodes(nodes: Vec<Node>, separator: &[u8], at_least: u8) -> Vec<u8> {
    let parts: Vec<Vec<u8>> = nodes.into_iter().map(|node| node.emit(at_least)).collect();
    parts.join(separator)
}

/// `emitTypeArguments`
fn type_arguments_text(nodes: Vec<Node>) -> Vec<u8> {
    if nodes.is_empty() {
        Vec::new()
    } else {
        cat!(b"<", join_nodes(nodes, b", ", CONDITIONAL), b">")
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum SignatureKind {
    Call,
    Construct,
    Method,
    GetAccessor,
    SetAccessor,
    FunctionType,
    ConstructorType,
}

/// `CompositeSymbolIdentity`: what the instantiations of one anonymous type have in common.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Identity {
    Origin(Origin),
    Instance(Sym),
    Function(FileId, FnId),
    /// A conditional type, or a deferred type reference.
    Node(FileId, TypeNodeId),
    Type(TypeId),
}

/// `yieldModuleSymbol` of `lookupSymbolChain`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum YieldModuleSymbol {
    No,
    Yes,
}

/// The node `createAccessFromSymbolChain` creates, as it is printed.
struct Access {
    text: Vec<u8>,
    /// For an `IndexedAccessTypeNode`: where in `text` the `ObjectType` of
    /// `getTopmostIndexedAccessType(node)` ends, and where that node ends. `None`: an entity name.
    topmost_indexed_access: Option<(usize, usize)>,
}

/// A parameter symbol of a signature.
#[derive(Clone)]
struct Parameter {
    name: Vec<u8>,
    /// `len(symbol.Name)`
    name_length: usize,
    ty: TypeId,
    optional: bool,
    rest: bool,
    declaration: Option<(FileId, ParamId)>,
}

/// `ReverseMappedSymbolLinks`
#[derive(Copy, Clone)]
struct ReverseMappedProperty {
    owner: TypeId,
    name: Atom,
    property_type: TypeId,
    mapped: Option<(FileId, TypeNodeId)>,
}

/// The syntax of the name in one declaration of a property.
#[derive(Copy, Clone)]
struct PropertyNameSyntax {
    is_string: bool,
    is_single_quoted: bool,
    /// The property has a `nameType`.
    is_computed: bool,
}

/// The position of the declaration of a property, as `compareSymbols` needs it.
enum Place {
    At((bool, u32, u32)),
    /// It has no declaration.
    Nowhere,
}

/// `NodeBuilderImpl` and its `NodeBuilderContext`.
/// A call of `ReportCyclicStructureError`, `ReportInaccessibleThisError`,
/// `ReportInaccessibleUniqueSymbolError`, `ReportLikelyUnsafeImportRequiredError`,
/// `ReportNonSerializableProperty` or `ReportPrivateInBaseOfClassExpression`: those a
/// `wrappingTracker` defers (`deferredReports`).
#[derive(Clone)]
pub(super) enum Report {
    CyclicStructure,
    InaccessibleThis,
    InaccessibleUniqueSymbol,
    /// The specifier, and the name of the symbol.
    LikelyUnsafeImportRequired(Vec<u8>, Vec<u8>),
    NonSerializableProperty(Vec<u8>),
    PrivateInBaseOfClassExpression(Vec<u8>),
}

/// `nodebuilder.SymbolTracker`, the methods the node builder calls. It is passed the checker, which
/// the printer holds while it runs.
pub(super) trait SymbolTracker<'p> {
    /// `TrackSymbol`. Returns whether a diagnostic is reported.
    fn track_symbol(
        &mut self,
        c: &mut Checker<'p, '_>,
        symbol: Sym,
        enclosing_declaration: Option<Enclosing>,
        meaning: SymFlags,
    ) -> bool;
    fn report(&mut self, c: &mut Checker<'p, '_>, report: Report);
    /// `ReportInferenceFallback`, of `node` of `file`.
    fn report_inference_fallback(&mut self, c: &mut Checker<'p, '_>, file: FileId, node: hir::Node);
    /// `ReportTruncationError`
    fn report_truncation_error(&mut self, c: &mut Checker<'p, '_>);
}

/// `TrackedSymbolArgs`
#[derive(Copy, Clone)]
struct TrackedSymbolArgs {
    symbol: Sym,
    enclosing_declaration: Option<Enclosing>,
    meaning: SymFlags,
}

/// `recoveryBoundary`
#[derive(Default)]
struct RecoveryBoundary {
    /// Set by a report, and where the visitor permanently fails on a node. Otherwise the visitor
    /// returns `None`.
    had_error: bool,
    tracked_symbols: Vec<TrackedSymbolArgs>,
    deferred_reports: Vec<Report>,
    old_tracked_symbols: Vec<TrackedSymbolArgs>,
    old_encountered_error: bool,
    old_approximate_length: usize,
}

/// `SerializedTypeEntry`
#[derive(Clone)]
struct SerializedTypeEntry {
    node: Node,
    /// `Printer::indent` where it was created.
    indent: Option<usize>,
    truncating: bool,
    added_length: usize,
    tracked_symbols: Vec<TrackedSymbolArgs>,
}

/// `CompositeTypeCacheIdentity`, after the node that has the links: the enclosing declaration, and
/// `Printer::enclosing_expression`.
type SerializedTypeKey = (Enclosing, Option<ExprId>, TypeId, u32);

/// `links.serializedTypes` of every node, in `c.typeToStringNodebuilder`.
#[derive(Default)]
pub(super) struct SerializedTypes(FxHashMap<SerializedTypeKey, SerializedTypeEntry>);

/// The locals of `visitAndTransformType` that outlive the call of `transform`.
struct TypeVisit {
    ty: TypeId,
    identity: Option<Identity>,
    /// The key of the result among the `serializedTypes`.
    key: Option<SerializedTypeKey>,
    /// What `Printer::symbol_depth` had for `identity`.
    depth: u32,
    previous_tracked_symbols: Vec<TrackedSymbolArgs>,
    start_length: usize,
}

/// The value `enterNewScope` returns, used to leave the scope.
#[derive(Copy, Clone)]
struct OuterScope {
    type_parameter_names: usize,
    type_parameter_name_counts: usize,
    type_parameter_symbol_list: usize,
    fake_scope_type_parameters: usize,
    fake_scope_parameters: usize,
    enclosing_declaration: Option<Enclosing>,
    has_fake_scope: [bool; 2],
    mapper: MapperId,
}

struct Printer<'c, 'p, 's> {
    c: &'c mut Checker<'p, 's>,
    flags: u32,
    /// The output is what the declaration transformer produces for a node of the file
    /// (`visitDeclarationSubtree`), not what the node builder produces to print a type
    /// (`getExistingNodeTreeVisitor`). They differ little.
    is_transformer: bool,
    /// `PrinterOptions.NeverAsciiEscape`
    never_ascii_escape: bool,
    /// `writer.GetIndent()` for the current line. `None`: everything is printed on one line
    /// (`SingleLineStringWriter`).
    indent: Option<usize>,
    /// `containerPos`, among the type nodes the transformer reuses. `usize::MAX`: -1.
    container_pos: usize,
    approximate_length: usize,
    truncating: bool,
    visited_types: Vec<TypeId>,
    symbol_depth: Vec<(Identity, u32)>,
    infer_type_parameters: Vec<TypeId>,
    reverse_mapped_stack: Vec<ReverseMappedProperty>,
    /// The mapper of the innermost instantiated signature being printed.
    mapper: MapperId,
    /// `enclosingSymbolTypes` for signature declarations: the return type of each, while it is
    /// printed from its syntax.
    enclosing_symbol_types: Vec<((FileId, FnId), TypeId)>,
    depth: u32,
    /// `enclosingDeclaration`: the scope from which names are resolved. `None` in error messages.
    enclosing_declaration: Option<Enclosing>,
    /// The expression that is the enclosing declaration of `typeToStringEx`.
    enclosing_expression: Option<ExprId>,
    /// `SymbolTrackerImpl.inner`, beneath all the `wrappingTracker`s.
    tracker: Option<&'c mut dyn SymbolTracker<'p>>,
    /// `wrappingTracker.bound` of each of those.
    boundaries: Vec<RecoveryBoundary>,
    /// `suppressReportInferenceFallback`
    suppress_report_inference_fallback: bool,
    reported_diagnostic: bool,
    encountered_error: bool,
    tracked_symbols: Vec<TrackedSymbolArgs>,
    /// `links.serializedTypes` of the nodes, and in the node builders, that last as long as this
    /// printer. See `serialized_types_of`.
    serialized_types: FxHashMap<SerializedTypeKey, SerializedTypeEntry>,
    /// Whether a block for the parameters, and one for the type parameters, is among the enclosing declarations
    /// (`fakeScopeForSignatureDeclaration`).
    has_fake_scope: [bool; 2],
    /// Number of synthetic blocks created.
    fake_scope_count: u32,
    /// `typeParameterNames` and `typeParameterNamesByText`. A later entry shadows an earlier one,
    /// here and in the next two.
    type_parameter_names: Vec<(TypeId, Vec<u8>)>,
    /// `typeParameterNamesByTextNextNameCount`
    type_parameter_name_counts: Vec<(Vec<u8>, u32)>,
    /// `typeParameterSymbolList`
    type_parameter_symbol_list: Vec<Sym>,
    /// The locals of the fake scopes that `enterNewScope` puts in front of `enclosing_declaration`
    /// and that a type lookup finds: type parameters, and parameters that share a symbol with a
    /// type parameter. `None`: such a parameter after `instantiateSymbol`.
    fake_scope_type_parameters: Vec<(Vec<u8>, Option<TypeId>)>,
    /// The locals of the fake scope of the parameters, as a value lookup finds them. `None`: a
    /// symbol that `instantiateSymbol` created.
    fake_scope_parameters: Vec<(Atom, Option<Sym>)>,
}

/// `encodeUtf16EscapeSequence`
fn encode_utf16_escape_sequence(out: &mut Vec<u8>, unit: u32) {
    let _ = write!(VecWriter(out), "\\u{unit:04X}");
}

/// `escapeStringWorker`. `escapes_non_ascii`: without `getLiteralTextFlagsNeverAsciiEscape`.
fn escape_string(text: &[u8], quote: u8, escapes_non_ascii: bool, out: &mut Vec<u8>) {
    let (iterator, mut cursor) = (CodepointIterator::init(text), Cursor::default());
    while iterator.next(&mut cursor) {
        let i = cursor.i as usize;
        let (byte, next) = (text[i], text.get(i + 1).copied());
        // `DecodeJSStringRune`: half a surrogate pair is a code point, a byte that is not valid
        // UTF-8 is U+FFFD.
        let (ch, is_malformed) = (cursor.c as u32, cursor.width == 1 && byte >= 0x80);
        match byte {
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'$' if quote == b'`' && next == Some(b'{') => out.extend_from_slice(b"\\$"),
            b'"' | b'\'' | b'`' if byte == quote => out.extend_from_slice(&[b'\\', byte]),
            // The line feed after it belongs to it, in a template too.
            b'\r' if quote == b'`' && next == Some(b'\n') => {
                cursor.width += 1;
                out.extend_from_slice(b"\\r\\n");
            }
            b'\r' => out.extend_from_slice(b"\\r"),
            // A template preserves its line feeds.
            b'\n' if quote == b'`' => out.push(b'\n'),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x0B => out.extend_from_slice(b"\\v"),
            0x0C => out.extend_from_slice(b"\\f"),
            0x08 => out.extend_from_slice(b"\\b"),
            0 if next.is_some_and(|next| next.is_ascii_digit()) => out.extend_from_slice(b"\\x00"),
            0 => out.extend_from_slice(b"\\0"),
            _ if is_malformed => encode_utf16_escape_sequence(out, 0xFFFD),
            _ if ch > 0xFFFF && escapes_non_ascii => {
                encode_utf16_escape_sequence(out, 0xD800 + ((ch - 0x10000) >> 10));
                encode_utf16_escape_sequence(out, 0xDC00 + ((ch - 0x10000) & 0x3FF));
            }
            _ if ch < 0x20
                || matches!(ch, 0x85 | 0x2028 | 0x2029 | 0xD800..=0xDFFF)
                || escapes_non_ascii && ch > 0x7F =>
            {
                encode_utf16_escape_sequence(out, ch);
            }
            _ => out.extend_from_slice(&text[i..i + usize::from(cursor.width)]),
        }
    }
}

/// A string literal. `escapes_non_ascii`: it is printed without `EFNoAsciiEscaping`.
pub(super) fn quoted(text: &[u8], quote: u8, escapes_non_ascii: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(quote);
    escape_string(text, quote, escapes_non_ascii, &mut out);
    out.push(quote);
    out
}

/// `createExpressionFromSymbolChain`, after the first symbol: `.name`, or `[name]` for a name that
/// is not an identifier. The brackets of a computed name are not doubled. `escapes_non_ascii`: the
/// printer has no `NeverAsciiEscape`.
pub(super) fn push_access(
    expression: &mut Vec<u8>,
    name: &[u8],
    is_enum_member: bool,
    escapes_non_ascii: bool,
) {
    // `canUsePropertyAccess`
    if is_identifier(name.strip_prefix(b"#").unwrap_or(name)) {
        expression.push(b'.');
        expression.extend_from_slice(name);
        return;
    }
    let inner = match name.strip_prefix(b"[") {
        Some(rest) => &rest[..rest.len().saturating_sub(1)],
        None => name,
    };
    expression.push(b'[');
    match inner.first() {
        Some(&quote @ (b'"' | b'\'')) if !is_enum_member => {
            expression.append(&mut quoted(
                &unquote_string(inner),
                quote,
                escapes_non_ascii,
            ));
        }
        _ => expression.extend_from_slice(inner),
    }
    expression.push(b']');
}

/// `stringutil.UnquoteString`
fn unquote_string(text: &[u8]) -> Vec<u8> {
    let inner = match text {
        [first, inner @ .., last] if first == last => inner,
        _ => text,
    };
    let mut unquoted = Vec::with_capacity(inner.len());
    let mut bytes = inner.iter().copied().peekable();
    while let Some(byte) = bytes.next() {
        // `\\.` does not match a line break.
        match bytes.next_if(|&next| byte == b'\\' && next != b'\n') {
            Some(next) => unquoted.push(next),
            None => unquoted.push(byte),
        }
    }
    unquoted
}

/// The properties whose `Declarations` make up those of `prop`, in order, until `visit` returns
/// true: `prop` itself, if it is declared.
/// `Checker::declared_properties` without the list.
pub(super) fn for_each_declared<'a>(
    prop: &'a Prop<'a>,
    visit: &mut dyn FnMut(&'a Prop<'a>) -> bool,
) -> bool {
    match &prop.source {
        PropSource::Type(_) => false,
        PropSource::Intersected(_, parts)
        | PropSource::Copy(_, parts, _)
        | PropSource::ReverseMapped(_, parts) => {
            parts.iter().any(|part| for_each_declared(part, visit))
        }
        PropSource::Mapped(..) => {
            let parts = prop.declared_by_modifiers_property();
            parts.iter().any(|part| for_each_declared(part, visit))
        }
        _ => visit(prop),
    }
}

/// What has `symbol.Declarations[0]`.
pub(super) fn first_declared<'a>(prop: &'a Prop<'a>) -> Option<&'a Prop<'a>> {
    let mut first = None;
    for_each_declared(prop, &mut |declared| {
        first = Some(declared);
        true
    });
    first
}

pub(super) fn string_mapping_name(kind: StringMappingKind) -> &'static [u8] {
    match kind {
        StringMappingKind::Uppercase => b"Uppercase",
        StringMappingKind::Lowercase => b"Lowercase",
        StringMappingKind::Capitalize => b"Capitalize",
        StringMappingKind::Uncapitalize => b"Uncapitalize",
    }
}

impl Checker<'_, '_> {
    /// `t.symbol` of the `unique symbol` named `name`.
    pub(super) fn symbol_of_unique_symbol(
        &mut self,
        declaration: UniqueSymbolDeclaration,
        name: Atom,
    ) -> Option<Sym> {
        match declaration {
            UniqueSymbolDeclaration::Variable(variable) => Some(variable),
            UniqueSymbolDeclaration::Member(file, m) => self.bound(file).member_symbol[m.idx()]
                .is_some()
                .then(|| self.symbol_of_member(file, m)),
            UniqueSymbolDeclaration::SymbolConstructor => {
                let container = self.global_type_symbol(known::SymbolConstructor)?;
                self.files().member(container, name)
            }
        }
    }

    /// `getVariableDeclarationOfObjectLiteral`. `first_declaration`: `symbol.Declarations[0]`, in
    /// `file`.
    pub(super) fn variable_declaration_of_object_literal(
        &self,
        file: FileId,
        first_declaration: Decl,
    ) -> Option<Sym> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let name = match first_declaration {
            Decl::ObjectLiteral(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(declaration) if !is_parenthesized(hir, e) => hir[declaration].pat,
                _ => return None,
            },
            Decl::TypeLiteral(node) => {
                let mut declarations = hir.var_decls.iter();
                let declaration = declarations.find(|declaration| declaration.ty == node)?;
                let mut parentheses = self.parenthesized_types_around(file, node, 0);
                if parentheses.next().is_some() {
                    return None;
                }
                declaration.pat
            }
            _ => return None,
        };
        let variable = bound.pat_symbol[name.idx()];
        variable.is_some().then(|| self.files().sym(file, variable))
    }
}

impl<'p, 's> Printer<'_, 'p, 's> {
    fn text(&self, name: Atom) -> Vec<u8> {
        self.c.atoms().bytes(name).to_vec()
    }

    /// `emitLiteral` for a string literal that has no `EFNoAsciiEscaping`.
    fn string_literal(&self, text: &[u8], quote: u8) -> Vec<u8> {
        quoted(text, quote, !self.never_ascii_escape)
    }

    // ───────────────────────────── the tracker (`symboltracker.go`, `nodecopy.go`) ─────────────────────────────

    /// `b.ctx.tracker.TrackSymbol(symbol, b.ctx.enclosingDeclaration, meaning)`
    fn track_symbol(&mut self, symbol: Sym, meaning: SymFlags) {
        self.track(TrackedSymbolArgs {
            symbol,
            enclosing_declaration: self.enclosing_declaration,
            meaning,
        });
    }

    /// `wrappingTracker.TrackSymbol`, `SymbolTrackerImpl.TrackSymbol`
    fn track(&mut self, tracked: TrackedSymbolArgs) {
        let Some(tracker) = self.tracker.as_deref_mut() else {
            return;
        };
        match self.boundaries.last_mut() {
            Some(boundary) => boundary.tracked_symbols.push(tracked),
            None => {
                if tracker.track_symbol(
                    self.c,
                    tracked.symbol,
                    tracked.enclosing_declaration,
                    tracked.meaning,
                ) {
                    self.reported_diagnostic = true;
                    return;
                }
            }
        }
        // `trackedSymbols` holds no type parameters.
        if !self
            .c
            .flags_of(tracked.symbol)
            .contains(SymFlags::TYPE_PARAMETER)
        {
            self.tracked_symbols.push(tracked);
        }
    }

    /// How `wrappingTracker` and `SymbolTrackerImpl` handle the calls that `Report` represents.
    fn report(&mut self, report: Report) {
        // `onDiagnosticReported`
        self.reported_diagnostic = true;
        // `markError`
        if let Some(boundary) = self.boundaries.last_mut() {
            boundary.had_error = true;
            if self.tracker.is_some() {
                boundary.deferred_reports.push(report);
            }
        } else if let Some(tracker) = self.tracker.as_deref_mut() {
            tracker.report(self.c, report);
        }
    }

    /// `bound.markError(nil)`
    fn mark_error(&mut self) {
        if let Some(boundary) = self.boundaries.last_mut() {
            boundary.had_error = true;
        }
    }

    /// `bound.hadError`
    fn had_error(&self) -> bool {
        self.boundaries
            .last()
            .is_some_and(|boundary| boundary.had_error)
    }

    /// `ReportInferenceFallback`, which is not deferred.
    fn report_inference_fallback(&mut self, file: FileId, node: hir::Node) {
        if let Some(tracker) = self.tracker.as_deref_mut() {
            tracker.report_inference_fallback(self.c, file, node);
        }
    }

    /// `exitContextCheck`
    fn exit_context_check(&mut self) {
        if self.truncating
            && self.flags & NO_TRUNCATION != 0
            && let Some(tracker) = self.tracker.as_deref_mut()
        {
            tracker.report_truncation_error(self.c);
        }
    }

    /// `createRecoveryBoundary`
    fn create_recovery_boundary(&mut self) {
        let old_tracked_symbols = std::mem::take(&mut self.tracked_symbols);
        self.boundaries.push(RecoveryBoundary {
            old_tracked_symbols,
            old_encountered_error: self.encountered_error,
            old_approximate_length: self.approximate_length,
            ..RecoveryBoundary::default()
        });
    }

    /// `finalizeBoundary`. `had_error`: the visitor returned `None`.
    fn finalize_boundary(&mut self, had_error: bool) -> bool {
        let Some(boundary) = self.boundaries.pop() else {
            return !had_error;
        };
        self.tracked_symbols = boundary.old_tracked_symbols;
        self.encountered_error = boundary.old_encountered_error;
        self.approximate_length = boundary.old_approximate_length;
        for report in boundary.deferred_reports {
            self.report(report);
        }
        if had_error || boundary.had_error {
            return false;
        }
        for tracked in boundary.tracked_symbols {
            self.track(tracked);
        }
        true
    }

    /// `startRecoveryScope`: `trackedSymbolsTop`, `unreportedErrorsTop`
    fn start_recovery_scope(&self) -> (usize, usize) {
        let unreported_errors_top = self
            .boundaries
            .last()
            .map_or(0, |boundary| boundary.deferred_reports.len());
        (self.tracked_symbols.len(), unreported_errors_top)
    }

    /// `endRecoveryScope`. The symbols it drops are those of the context, not those of the boundary, which stay tracked.
    fn end_recovery_scope(&mut self, state: (usize, usize)) {
        self.tracked_symbols.truncate(state.0);
        if let Some(boundary) = self.boundaries.last_mut() {
            boundary.had_error = false;
            boundary.deferred_reports.truncate(state.1);
        }
    }

    /// `typeToTypeNode(t)` under `suppressReportInferenceFallback`
    fn type_to_node_without_inference_fallback(&mut self, ty: TypeId) -> Node {
        let suppressed = std::mem::replace(&mut self.suppress_report_inference_fallback, true);
        let node = self.type_to_node(ty);
        self.suppress_report_inference_fallback = suppressed;
        node
    }

    // ───────────────────────────── truncation ─────────────────────────────

    /// `checkTruncationLength`
    fn check_truncation_length(&mut self) -> bool {
        if self.truncating {
            return true;
        }
        let maximum = if self.flags & NO_TRUNCATION != 0 {
            NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH
        } else {
            DEFAULT_MAXIMUM_TRUNCATION_LENGTH
        };
        self.truncating = self.approximate_length > maximum;
        self.truncating
    }

    /// `...`. Without truncation it is `any` with a comment, and comments are only emitted to a
    /// declaration file.
    fn elision(&self) -> Node {
        if self.flags & NO_TRUNCATION == 0 {
            return Node {
                reference: Some(b"...".to_vec()),
                ..Node::simple(b"...")
            };
        }
        Node::simple(if self.indent.is_some() {
            ELIDED
        } else {
            &b"any"[..]
        })
    }

    /// `... n more ...`
    fn more_elided(&self, count: usize) -> Node {
        if self.flags & NO_TRUNCATION != 0 {
            Node::simple(b"any")
        } else {
            Node::simple(cat! { b"... ", itoa(&mut ItoaBuf::new(), count), b" more ..." })
        }
    }

    /// `createElidedInformationPlaceholder`
    fn elided_information_placeholder(&mut self) -> Node {
        self.approximate_length += 3;
        self.elision()
    }

    // ───────────────────────────── types ─────────────────────────────

    /// `typeToTypeNode`
    fn type_to_node(&mut self, ty: TypeId) -> Node {
        if self.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return self.elided_information_placeholder();
        }
        self.depth += 1;
        let node = self.type_to_node_worker(ty);
        self.depth -= 1;
        node
    }

    fn type_to_node_worker(&mut self, ty: TypeId) -> Node {
        let ty = if self.flags & NO_TYPE_REDUCTION == 0 {
            self.c.reduced(ty)
        } else {
            ty
        };
        match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => {
                let (text, length): (&[u8], usize) = match intrinsic {
                    Intrinsic::Unresolved
                    | Intrinsic::Any
                    | Intrinsic::Error
                    | Intrinsic::Auto
                    | Intrinsic::Wildcard
                    | Intrinsic::NonInferrableAny => (b"any", 3),
                    Intrinsic::IntrinsicMarker => (b"intrinsic", 3),
                    Intrinsic::Unknown => (b"unknown", 0),
                    Intrinsic::Never
                    | Intrinsic::SilentNever
                    | Intrinsic::UnreachableNever
                    | Intrinsic::ImplicitNever
                    | Intrinsic::UniqueLiteral => (b"never", 5),
                    Intrinsic::Void => (b"void", 4),
                    Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening => {
                        (b"undefined", 9)
                    }
                    Intrinsic::Null | Intrinsic::NullWidening => (b"null", 4),
                    Intrinsic::String => (b"string", 6),
                    Intrinsic::Number => (b"number", 6),
                    Intrinsic::BigInt => (b"bigint", 6),
                    Intrinsic::Symbol => (b"symbol", 6),
                    Intrinsic::Object => (b"object", 6),
                };
                self.approximate_length += length;
                return Node::simple(text);
            }
            TypeData::Union(_) if self.c.is_boolean(ty) && self.c.stored_alias(ty).is_none() => {
                self.approximate_length += 7;
                return Node::simple(b"boolean");
            }
            TypeData::Union(members) => {
                if let Some(enumeration) = self.enum_of_members(ty, members) {
                    return self.symbol_to_type_node(enumeration, false, Vec::new());
                }
            }
            TypeData::EnumLit { member, .. } => return self.enum_member_to_node(ty, *member),
            TypeData::Enum { symbol, .. } => {
                let symbol = *symbol;
                if self.c.files().flags(symbol).contains(SymFlags::ENUM_MEMBER) {
                    return self.enum_member_to_node(ty, symbol);
                }
                return self.symbol_to_type_node(symbol, false, Vec::new());
            }
            TypeData::StringLit { value, .. } => {
                let value = self.c.atoms().bytes(*value);
                self.approximate_length += value.len() + 2;
                return Node::simple(quoted(value, b'"', false));
            }
            TypeData::NumberLit { bits, .. } => {
                let text = crate::atom::number_to_string(f64::from_bits(*bits));
                self.approximate_length += text.len();
                return Node::simple(text);
            }
            TypeData::BigIntLit { text, negative, .. } => {
                let digits = self.text(*text);
                let digits = digits.strip_suffix(b"n").unwrap_or(&digits);
                let sign: &[u8] = if *negative { b"-" } else { b"" };
                self.approximate_length += sign.len() + digits.len() + 1;
                return Node::simple(cat!(sign, digits, b"n"));
            }
            TypeData::BoolLit { value, .. } => {
                self.approximate_length += if *value { 4 } else { 5 };
                return Node::simple(if *value { &b"true"[..] } else { b"false" });
            }
            TypeData::UniqueSymbol { symbol, name } => {
                let (declaration, name) = (*symbol, *name);
                if self.flags & ALLOW_UNIQUE_ES_SYMBOL_TYPE == 0 {
                    if let Some(symbol) = self.c.symbol_of_unique_symbol(declaration, name)
                        && self.is_value_symbol_accessible(symbol)
                    {
                        self.approximate_length += 6;
                        return self.symbol_to_type_node(symbol, true, Vec::new());
                    }
                    self.report(Report::InaccessibleUniqueSymbol);
                }
                self.approximate_length += 13;
                return Node::new(b"unique symbol", TYPE_OPERATOR);
            }
            TypeData::ThisParam(_) => {
                if self.flags & IN_OBJECT_TYPE_LITERAL != 0 {
                    if self.flags & ALLOW_THIS_IN_OBJECT_LITERAL == 0 {
                        self.encountered_error = true;
                    }
                    self.report(Report::InaccessibleThis);
                }
                self.approximate_length += 4;
                return Node::simple(b"this");
            }
            // `typeToTypeNode`: an `any` with an alias is printed as the alias.
            TypeData::UnresolvedName { name, args } => {
                let name = self.text(*name);
                let arguments = self.map_to_type_nodes(args, false);
                let text = cat!(name, type_arguments_text(arguments));
                // `symbolToEntityNameNode`: a qualified name for a symbol that has a parent.
                let is_identifier = !bun_core::strings::contains_char(&name, b'.');
                return Node {
                    reference: is_identifier.then_some(name),
                    ..Node::simple(text)
                };
            }
            _ => {}
        }
        if let Some((alias, arguments)) = self.c.alias_of_type(ty)
            && (self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE != 0
                || self.is_type_symbol_accessible(alias))
        {
            let arguments = self.map_to_type_nodes(&arguments, false);
            return self.symbol_to_type_node(alias, false, arguments);
        }
        // `t.AsTypeReference().node != nil`
        let node_of_reference = self
            .c
            .types()
            .deferred(ty)
            .map(|reference| Identity::Node(reference.file, reference.node));
        match self.c.data(ty) {
            TypeData::Ref { target, .. } if node_of_reference.is_some() => self
                .visit_and_transform_type(ty, node_of_reference, |printer, ty| {
                    let args = printer.c.type_arguments(ty);
                    printer.type_reference_to_node(ty, *target, args)
                }),
            TypeData::Tuple {
                flags, readonly, ..
            } if node_of_reference.is_some() => {
                self.visit_and_transform_type(ty, node_of_reference, |printer, ty| {
                    let elems = printer.c.type_arguments(ty);
                    printer.tuple_to_node(elems, flags, *readonly)
                })
            }
            TypeData::Ref { target, .. } => {
                let args = self.c.type_arguments(ty);
                self.type_reference_to_node(ty, *target, args)
            }
            TypeData::Tuple {
                flags, readonly, ..
            } => {
                let elems = self.c.type_arguments(ty);
                self.tuple_to_node(elems, flags, *readonly)
            }
            TypeData::TypeParam(..) => self.type_parameter_to_node(ty),
            TypeData::Marker(Marker::Restrictive(of)) => self.type_to_node(*of),
            TypeData::Marker(marker) => Node::simple(self.name_of_marker(*marker)),
            TypeData::Union(_) => self.union_to_node(ty),
            TypeData::Intersection(members) => self.intersection_to_node(members),
            TypeData::Anon { .. }
            | TypeData::Fns { .. }
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. } => self.anonymous_type_to_node(ty),
            // `getFinalArrayType`
            TypeData::EvolvingArray(element) => {
                let element = match *element {
                    TypeId::NEVER => TypeId::ANY,
                    element => element,
                };
                let array = self.c.array_of(element);
                self.type_to_node(array)
            }
            TypeData::Keyof(of) => {
                self.approximate_length += 6;
                let of = self.type_to_node(*of);
                Node::new(cat!(b"keyof ", of.emit(TYPE_OPERATOR)), TYPE_OPERATOR)
            }
            TypeData::Template { texts, types } => self.template_to_node(texts, types),
            TypeData::StringMapping { kind, ty: of } => {
                let of = self.type_to_node(*of);
                self.intrinsic_alias_to_node(string_mapping_name(*kind), &of)
            }
            TypeData::Substitution { base, constraint } => {
                let base = self.type_to_node(*base);
                if *constraint != TypeId::UNKNOWN {
                    return base;
                }
                self.intrinsic_alias_to_node(b"NoInfer", &base)
            }
            TypeData::IndexedAccess { obj, index, .. } => {
                let object = self.type_to_node(*obj);
                let index = self.type_to_node(*index);
                self.approximate_length += 2;
                Node::new(cat!(object.emit(POSTFIX), b"[", index.text, b"]"), POSTFIX)
            }
            TypeData::Cond { file, node, .. } => {
                let (file, node) = (*file, *node);
                let identity = Some(Identity::Node(file, node));
                self.visit_and_transform_type(ty, identity, |printer, ty| {
                    printer.conditional_type_to_node(ty, file, node)
                })
            }
            // Written above.
            _ => Node::simple(b"any"),
        }
    }

    /// `IsSymbolAccessible(symbol, enclosingDeclaration, meaning, false)`
    fn is_symbol_accessible(&mut self, symbol: Sym, meaning: SymFlags) -> bool {
        match self.enclosing_declaration {
            Some(at) => self.c.is_symbol_accessible_at(symbol, meaning, false, at),
            None => true,
        }
    }

    /// `IsValueSymbolAccessible(symbol, enclosingDeclaration)`
    fn is_value_symbol_accessible(&mut self, symbol: Sym) -> bool {
        self.is_symbol_accessible(symbol, SymFlags::VALUE)
    }

    /// `IsTypeSymbolAccessible(symbol, enclosingDeclaration)`
    fn is_type_symbol_accessible(&mut self, symbol: Sym) -> bool {
        match self.enclosing_declaration {
            Some(at) => self.c.is_type_symbol_accessible_at(symbol, at),
            None => true,
        }
    }

    /// `getTypeAliasForTypeLiteral`
    fn type_alias_for_type_literal(&self, ty: TypeId) -> Option<Sym> {
        let TypeData::Anon {
            origin: Origin::TypeLiteral(file, node),
            ..
        } = *self.c.data(ty)
        else {
            return None;
        };
        let aliases = &self.c.hir(file).aliases;
        let index = aliases.iter().position(|alias| alias.ty == node)?;
        let symbol = self.c.bound(file).alias_symbol[index];
        symbol.is_some().then(|| self.c.files().sym(file, symbol))
    }

    /// `symbolToTypeNode` of `Uppercase`, `NoInfer` and the like, with one type argument.
    fn intrinsic_alias_to_node(&mut self, name: &[u8], argument: &Node) -> Node {
        self.approximate_length += 2 * (name.len() + 1);
        Node {
            reference: Some(name.to_vec()),
            ..Node::simple(cat!(name, b"<", argument.text, b">"))
        }
    }

    /// The name of a type parameter that has no symbol.
    fn name_of_marker(&self, marker: Marker) -> Vec<u8> {
        let parameter = self.c.variance_type_parameter;
        match marker {
            Marker::SuperForCheck if parameter.is_some() => cat!(b"super-", self.text(parameter)),
            Marker::SubForCheck if parameter.is_some() => cat!(b"sub-", self.text(parameter)),
            _ => b"?".to_vec(),
        }
    }

    fn template_to_node(&mut self, texts: &[Atom], types: &[TypeId]) -> Node {
        let mut text = b"`".to_vec();
        for (i, &piece) in texts.iter().enumerate() {
            let piece = self.text(piece);
            escape_string(&piece, b'`', false, &mut text);
            if let Some(&ty) = types.get(i) {
                let node = self.type_to_node(ty);
                text.extend_from_slice(b"${");
                text.extend_from_slice(&node.text);
                text.push(b'}');
            }
        }
        text.push(b'`');
        self.approximate_length += 2;
        Node::simple(text)
    }

    /// `visitAndTransformType`
    fn visit_and_transform_type(
        &mut self,
        ty: TypeId,
        identity: Option<Identity>,
        transform: impl FnOnce(&mut Self, TypeId) -> Node,
    ) -> Node {
        match self.begin_type_visit(ty, identity) {
            ControlFlow::Continue(visit) => {
                let node = transform(self, ty);
                self.end_type_visit(visit, node)
            }
            ControlFlow::Break(node) => node,
        }
    }

    /// `b.links.Get(b.ctx.enclosingDeclaration).serializedTypes`. `typeToStringEx` uses one node
    /// builder for the life of the checker, every other caller a new one, and a synthetic block of
    /// `enterNewScope` is a new node.
    fn serialized_types_of(
        &mut self,
        key: &SerializedTypeKey,
    ) -> &mut FxHashMap<SerializedTypeKey, SerializedTypeEntry> {
        if key.1.is_some() && key.0.fake_scope == 0 {
            &mut self.c.serialized_types.0
        } else {
            &mut self.serialized_types
        }
    }

    /// `visitAndTransformType`, up to the call of `transform`. `Break`: the result, without that
    /// call.
    fn begin_type_visit(
        &mut self,
        ty: TypeId,
        identity: Option<Identity>,
    ) -> ControlFlow<Node, TypeVisit> {
        match identity {
            Some(Identity::Origin(origin)) => self.c.get_symbol_id_of_origin(origin),
            Some(Identity::Instance(symbol)) => self.c.get_symbol_id(symbol),
            Some(Identity::Function(file, function)) => {
                self.c.get_symbol_id_of_function(file, function);
            }
            Some(Identity::Node(..) | Identity::Type(_)) | None => {}
        }
        let key = self
            .enclosing_declaration
            .map(|at| (at, self.enclosing_expression, ty, self.flags));
        if let Some(key) = &key
            && let Some(cached) = self.serialized_types_of(key).get(key)
        {
            let cached = cached.clone();
            for tracked in cached.tracked_symbols {
                self.track(tracked);
            }
            self.truncating |= cached.truncating;
            self.approximate_length += cached.added_length;
            let node = cached.node.deep_clone();
            return ControlFlow::Break(match (cached.indent, self.indent) {
                (Some(from), Some(to)) if from != to => node.indented(from, to),
                _ => node,
            });
        }
        let mut depth = 0;
        if let Some(identity) = identity {
            match self
                .symbol_depth
                .iter_mut()
                .find(|entry| entry.0 == identity)
            {
                Some(entry) => {
                    depth = entry.1;
                    if depth > 10 {
                        return ControlFlow::Break(self.elided_information_placeholder());
                    }
                    entry.1 = depth + 1;
                }
                None => self.symbol_depth.push((identity, 1)),
            }
        }
        self.visited_types.push(ty);
        ControlFlow::Continue(TypeVisit {
            ty,
            identity,
            key,
            depth,
            previous_tracked_symbols: std::mem::take(&mut self.tracked_symbols),
            start_length: self.approximate_length,
        })
    }

    /// `visitAndTransformType`, from where `transform` has returned `node`.
    fn end_type_visit(&mut self, visit: TypeVisit, node: Node) -> Node {
        let TypeVisit {
            ty,
            identity,
            key,
            depth,
            previous_tracked_symbols,
            start_length,
        } = visit;
        let added_length = self.approximate_length.saturating_sub(start_length);
        let tracked_symbols =
            std::mem::replace(&mut self.tracked_symbols, previous_tracked_symbols);
        if let Some(key) = key
            && !self.reported_diagnostic
            && !self.encountered_error
        {
            let entry = SerializedTypeEntry {
                node: node.clone(),
                indent: self.indent,
                truncating: self.truncating,
                added_length,
                tracked_symbols,
            };
            self.serialized_types_of(&key).insert(key, entry);
        }
        self.visited_types.retain(|&visited| visited != ty);
        if let Some(identity) = identity
            && let Some(entry) = self
                .symbol_depth
                .iter_mut()
                .find(|entry| entry.0 == identity)
        {
            entry.1 = depth;
        }
        node
    }

    // ───────────────────────────── enums ─────────────────────────────

    /// The enum whose declared type is the union `ty` of `members`.
    fn enum_of_members(&mut self, ty: TypeId, members: &[TypeId]) -> Option<Sym> {
        let member = match *self.c.data(*members.first()?) {
            TypeData::EnumLit { member, .. } => member,
            TypeData::Enum { symbol, .. } => symbol,
            _ => return None,
        };
        let parent = self.c.files().parent_of_symbol(member)?;
        (self.c.enum_type_of_member(member) == ty).then_some(parent)
    }

    /// `E.A`, or `E` if the member is the only member of the enum.
    fn enum_member_to_node(&mut self, ty: TypeId, member: Sym) -> Node {
        let Some(parent) = self.c.files().parent_of_symbol(member) else {
            return self.symbol_to_type_node(member, false, Vec::new());
        };
        let parent_name = self.symbol_to_type_node(parent, false, Vec::new());
        if self.c.enum_type_of_member(member) == ty {
            return parent_name;
        }
        let name = match self.c.files().symbol(member).name {
            // `InternalSymbolNamePrefix` is not valid UTF-8.
            known::missing => b"\xEF\xBF\xBDmissing".to_vec(),
            name => self.text(name),
        };
        if is_identifier(&name) {
            return Node::simple(cat!(parent_name.text, b".", name));
        }
        let literal = self.string_literal(&name, b'"');
        if parent_name.text.starts_with(b"import(") {
            Node::new(
                cat!(b"typeof ", parent_name.text, b"[", literal, b"]"),
                POSTFIX,
            )
        } else {
            Node::new(
                cat!(b"(typeof ", parent_name.text, b")[", literal, b"]"),
                POSTFIX,
            )
        }
    }

    // ───────────────────────────── symbols ─────────────────────────────

    /// `a`, `a.b.c`
    fn entity_name_text(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        match self.c.hir(file)[e].kind {
            ExprKind::Ident(name) => Some(self.text(name)),
            ExprKind::Dot { obj, name, .. } => Some(cat! {
                self.entity_name_text(file, obj)?, b".", self.text(name)
            }),
            _ => None,
        }
    }

    /// `GetTextOfNode`. Empty: it is missing, the HIR does not record its start, or the text is not
    /// retained (the default library).
    fn get_text_of_node(&self, file: FileId, node: hir::Node) -> &'p [u8] {
        let hir = self.c.hir(file);
        let (start, end) = (hir.start(node), self.c.end_of_node(file, node));
        let text = hir.text.get(start as usize..end as usize);
        text.filter(|_| start != 0).unwrap_or_default()
    }

    /// `DeclarationNameToString`. The source text is used only for what `node.Text()` lacks, the escapes of an identifier. A name is not
    /// always at `start` (the name of an `@overload` is at the tag), and a missing name still has a token at that position.
    fn declaration_name_to_string(&self, file: FileId, name: hir::Node) -> Vec<u8> {
        match self.get_text_of_node(file, name) {
            written if bun_core::strings::contains_char(written, b'\\') => written.to_vec(),
            _ => self.property_key_text(file, name),
        }
    }

    /// The same for a clone of the name, which the printer emits as its `node.Text()`: an
    /// identifier has its escapes decoded.
    fn property_key_text(&self, file: FileId, name: hir::Node) -> Vec<u8> {
        let hir = self.c.hir(file);
        let (text, written) = (hir.text(name), self.get_text_of_node(file, name));
        match (hir.kind(name), written.first()) {
            (_, Some(b'[' | b'"' | b'\'' | b'0'..=b'9')) => written.to_vec(),
            // `.5`. A name that is missing before a `.` is not written.
            (_, Some(b'.')) if written.get(1).is_some_and(u8::is_ascii_digit) => written.to_vec(),
            (Kind::ComputedPropertyName, _) => match hir.data(hir.expression(name)) {
                NodeData::Expr(e) => self.entity_name_text(file, e),
                _ => None,
            }
            .map_or_else(|| b"(Missing)".to_vec(), |name| cat!(b"[", name, b"]")),
            // The kind decides where there is no text, in the default library. A JSON file has
            // `StringLiteral` for every name, even a bare word.
            (Kind::StringLiteral, _) if hir.text.is_empty() => {
                quoted(&self.text(text), b'"', false)
            }
            (Kind::PrivateIdentifier, _) if text.is_some() => self.c.written_name(text).to_vec(),
            _ if text.is_some() && text != known::empty => self.text(text),
            // A name that declares nothing (`getDeclarationName`), as in the source: `#x` outside a
            // class.
            (_, Some(b'#')) => written.to_vec(),
            _ => b"(Missing)".to_vec(),
        }
    }

    /// `DeclarationNameToString(GetNameOfDeclaration(decl))`
    fn name_of_declaration(&self, file: FileId, decl: Decl) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        // `GetNonAssignedNameOfDeclaration`
        let name = match decl {
            Decl::ExportsProperty(e) | Decl::Expando(e) => {
                let name = self.c.name_of_assignment_declaration(file, e);
                return name;
            }
            // It is the name itself. `hir.node(decl)` would go up to the declaration and `name`
            // down again.
            Decl::Var(name) | Decl::Param(name) | Decl::Require(name) => hir.node(name),
            Decl::ExportExpr(s) => match hir[s].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)
                    if matches!(hir[e].kind, ExprKind::Ident(_)) =>
                {
                    hir.node(e)
                }
                _ => hir::Node::NONE,
            },
            _ => hir.name(hir.node(decl)),
        };
        name.is_some()
            .then(|| self.declaration_name_to_string(file, name))
    }

    /// `DeclarationNameToString(GetAssignedName(e))`: the name of the declaration `e` is assigned
    /// to.
    fn name_of_initialized_variable(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let start = self.c.bound(file).get_assigned_name(hir, e)?;
        let end = self.c.end_of_name_at(file, start);
        hir.text
            .get(start as usize..end as usize)
            .map(<[u8]>::to_vec)
    }

    /// `ast.FindAncestor(node, isDefaultBindingContext)` for a node in `scope` of `file`: the scope
    /// of the ambient module, or that of the file.
    fn default_binding_context(&self, file: FileId, mut scope: ScopeId) -> (FileId, ScopeId) {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        while scope.is_some() {
            let enclosing = &bound.scopes[scope.idx()];
            if let ScopeKind::Module(m) = enclosing.kind
                && !matches!(hir[m].name, ModuleName::Ident(_))
            {
                return (file, scope);
            }
            scope = enclosing.parent;
        }
        (file, ScopeId(0))
    }

    /// `getNameOfSymbolAsWritten` for the class expression, function expression or arrow function
    /// `e`, from where its declarations have no name of their own. `anonymous`: `(Anonymous ..)`.
    fn name_of_anonymous_expression(
        &mut self,
        file: FileId,
        e: ExprId,
        anonymous: &[u8],
    ) -> Vec<u8> {
        if let Some(name) = self.name_of_initialized_variable(file, e) {
            return name;
        }
        if self.flags & ALLOW_ANONYMOUS_IDENTIFIER == 0 {
            self.encountered_error = true;
        }
        anonymous.to_vec()
    }

    /// `getNameOfSymbolAsWritten`. `is_initial`: `FlagsInInitialEntityName`.
    fn name_of_symbol_as_written(&mut self, symbol: Sym, is_initial: bool) -> Vec<u8> {
        // `remappedSymbolReferences`
        self.c.get_symbol_id(symbol);
        let files = self.c.files();
        let decls = files.decls(symbol);
        let name = files.symbol(symbol).name;
        let is_in_other_binding_context = |&(file, decl): &(FileId, Decl)| {
            self.enclosing_declaration.is_some_and(|at| {
                let scope = (self.c.bound(file)).scope_of_declaration(self.c.hir(file), decl);
                self.default_binding_context(file, scope)
                    != self.default_binding_context(at.file, at.scope)
            })
        };
        if name == known::default
            && self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0
            && (!is_initial || decls.first().is_none_or(is_in_other_binding_context))
        {
            return b"default".to_vec();
        }
        if let Some(name) = decls
            .iter()
            .find_map(|&(file, decl)| self.name_of_declaration(file, decl))
        {
            return name;
        }
        match decls.first() {
            Some(&(file, Decl::Class(class))) => {
                if let ClassOwner::Expr(e) = self.c.bound(file).class_owner[class.idx()] {
                    return self.name_of_anonymous_expression(file, e, b"(Anonymous class)");
                }
            }
            Some(&(file, Decl::Fn(function))) => {
                if let FnOwner::Expr(e) = self.c.bound(file).fns[function.idx()].owner {
                    return self.name_of_anonymous_expression(file, e, b"(Anonymous function)");
                }
            }
            Some(&(file, Decl::TypeLiteral(node))) => {
                return self.c.name_of_type_literal(file, node);
            }
            Some(&(file, Decl::ObjectLiteral(e))) => return self.c.name_of_object_literal(file, e),
            Some(&(file, Decl::File)) => {
                let file_name = displayed_path(files.module(file).file_name());
                return cat! { b"\"", remove_file_extension(&file_name), b"\"" };
            }
            _ => {}
        }
        if name.is_some() {
            return self.escape_internal_symbol_name(name);
        }
        match decls.first() {
            Some(&(_, Decl::Class(_))) => b"__class".to_vec(),
            Some(&(_, Decl::Fn(_))) => b"__function".to_vec(),
            _ => b"__type".to_vec(),
        }
    }

    /// `EscapeInternalSymbolName`. The text of most internal names ends with `=` here, where the
    /// original starts with `InternalSymbolNamePrefix`.
    fn escape_internal_symbol_name(&self, name: Atom) -> Vec<u8> {
        let text = self.c.symbol_name_with_id(name);
        let text = &text[..];
        let rest = match name {
            known::anonymous_function
            | known::object_literal
            | known::computed
            | known::assignment_declaration
            | known::missing
            | known::constructor_declaration
            | known::call_signature
            | known::construct_signature
            | known::index_signature
            | known::type_literal => &text[..text.len() - 1],
            _ => match text.strip_prefix(b"\xFE") {
                Some(rest) => rest,
                None => return text.to_vec(),
            },
        };
        cat!(b"__", rest)
    }

    /// `symbol.Name`. Empty for an anonymous symbol.
    fn symbol_name(&self, symbol: Sym) -> &'p [u8] {
        match self.c.files().symbol(symbol).name {
            name if name.is_some() => self.c.atoms().bytes(name),
            _ => &b""[..],
        }
    }

    /// `symbolToExpression` of a chain of one, as `symbolToString` has it.
    fn symbol_to_text(&mut self, symbol: Sym) -> Vec<u8> {
        self.create_expression_from_symbol_chain(&[symbol], 0)
    }

    /// `lookupSymbolChain`. `meaning`: `SymFlags::VALUE` or `SymFlags::TYPE`.
    fn lookup_symbol_chain(
        &mut self,
        symbol: Sym,
        meaning: SymFlags,
        yield_module_symbol: YieldModuleSymbol,
    ) -> Vec<Sym> {
        self.track_symbol(symbol, meaning);
        // `lookupSymbolChainWorker`
        let flags = self.c.files().flags(symbol);
        if flags.contains(SymFlags::TYPE_PARAMETER)
            || self.enclosing_declaration.is_none() && self.flags & USE_FULLY_QUALIFIED_TYPE == 0
        {
            return vec![symbol];
        }
        let at = self.enclosing_declaration.unwrap_or(Enclosing::NONE);
        let chain = self.get_symbol_chain(symbol, meaning, yield_module_symbol, at);
        self.with_global_this(chain)
    }

    /// The chain `lookup_symbol_chain_at` returns, in one piece.
    fn with_global_this(&self, (starts_with_global_this, mut chain): (bool, Vec<Sym>)) -> Vec<Sym> {
        if starts_with_global_this {
            chain.insert(0, self.c.files().global_this_symbol);
        }
        chain
    }

    /// `getSymbolChain` from `at`, which may be a synthetic block created by `enterNewScope`.
    /// Its locals only count if one of them has the name of `symbol`, or of the first symbol of the
    /// chain computed without them: `trySymbolTable` and `needsQualification` look up nothing else.
    fn get_symbol_chain(
        &mut self,
        symbol: Sym,
        meaning: SymFlags,
        yield_module_symbol: YieldModuleSymbol,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let is_value = meaning == SymFlags::VALUE;
        let found =
            self.c
                .lookup_symbol_chain_at(symbol, is_value, yield_module_symbol, at, Vec::new());
        let first = if found.0 { None } else { found.1.first() };
        if at.fake_scope == 0
            || !self.is_name_of_fake_local(symbol)
                && !first.is_some_and(|&first| self.is_name_of_fake_local(first))
        {
            return found;
        }
        let mut locals: Vec<(Atom, SymFlags, Option<Sym>)> = Vec::new();
        // The block of the type parameters is nested in that of the parameters. In each a later
        // entry shadows an earlier one.
        for (name, parameter) in self.fake_scope_type_parameters.iter().rev() {
            let Some(name) = self.c.atoms().lookup(name) else {
                continue;
            };
            if locals.iter().any(|local| local.0 == name) {
                continue;
            }
            let symbol = parameter.and_then(|parameter| match *self.c.data(parameter) {
                TypeData::TypeParam(file, tp, _) => {
                    let id = self.c.bound(file).type_param_symbol[tp.idx()];
                    id.is_some().then_some(Sym { file, id })
                }
                _ => None,
            });
            locals.push((name, SymFlags::TYPE_PARAMETER, symbol));
        }
        let type_parameters = locals.len();
        for &(name, parameter) in self.fake_scope_parameters.iter().rev() {
            let mut parameters = locals[type_parameters..].iter();
            if !parameters.any(|local| local.0 == name) {
                locals.push((name, SymFlags::FUNCTION_SCOPED_VARIABLE, parameter));
            }
        }
        self.c
            .lookup_symbol_chain_at(symbol, is_value, yield_module_symbol, at, locals)
    }

    fn is_name_of_fake_local(&self, symbol: Sym) -> bool {
        let files = self.c.files();
        let name = files.symbol(symbol).name;
        if name.is_none() {
            return false;
        }
        let text = self.c.atoms().bytes(name);
        let mut parameters = self.fake_scope_parameters.iter();
        let mut type_parameters = self.fake_scope_type_parameters.iter();
        parameters.any(|local| local.0 == name) || type_parameters.any(|local| local.0 == text)
    }

    /// `typeParametersToTypeParameterDeclarations`, as it is printed: `<T, U>`, or nothing.
    fn type_parameters_to_type_parameter_declarations(&mut self, symbol: Sym) -> Vec<u8> {
        let files = self.c.files();
        let flags = files.flags(symbol);
        let params: Vec<TypeId> =
            if flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE | SymFlags::ALIAS) {
                self.c.local_type_params_of_symbol(symbol).into_vec()
            } else if flags.contains(SymFlags::FUNCTION)
                && let Some((file, Decl::Fn(function))) = files.value_declaration(symbol)
            {
                let type_params = self.c.hir(file)[function].type_params;
                let declared = |tp| self.c.declared_type_of_type_parameter(file, tp);
                type_params.iter().map(declared).collect()
            } else {
                Vec::new()
            };
        if params.is_empty() {
            return Vec::new();
        }
        let mut declarations = Vec::with_capacity(params.len());
        for param in params {
            declarations.push(self.type_parameter_declaration(param, &[]));
        }
        cat!(b"<", declarations.join(&b", "[..]), b">")
    }

    /// `shouldWriteTypeParametersInQualifiedName`
    fn should_write_type_parameters_in_qualified_name(&self, chain: &[Sym], index: usize) -> bool {
        self.flags & WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME != 0 && index < chain.len() - 1
    }

    /// `lookupTypeParameterNodes`, as they are printed. No symbol of a chain is instantiated
    /// (`lookupInstantiatedTypeArgumentNodes`).
    fn lookup_type_parameter_nodes(&mut self, chain: &[Sym], index: usize) -> Vec<u8> {
        self.c.get_symbol_id(chain[index]);
        if self.type_parameter_symbol_list.contains(&chain[index]) {
            return Vec::new();
        }
        self.type_parameter_symbol_list.push(chain[index]);
        if !self.should_write_type_parameters_in_qualified_name(chain, index) {
            return Vec::new();
        }
        self.type_parameters_to_type_parameter_declarations(chain[index])
    }

    /// `lookupExpressionChainTypeArgumentNodes`
    fn lookup_expression_chain_type_argument_nodes(
        &mut self,
        chain: &[Sym],
        index: usize,
    ) -> Vec<u8> {
        if !self.should_write_type_parameters_in_qualified_name(chain, index) {
            return Vec::new();
        }
        self.lookup_type_parameter_nodes(chain, index)
    }

    /// `symbolToExpression(symbol, SymbolFlagsValue)`
    fn symbol_to_expression(&mut self, symbol: Sym) -> Vec<u8> {
        let chain = self.lookup_symbol_chain(symbol, SymFlags::VALUE, YieldModuleSymbol::No);
        self.create_expression_from_symbol_chain(&chain, chain.len() - 1)
    }

    /// `createExpressionFromSymbolChain`
    fn create_expression_from_symbol_chain(&mut self, chain: &[Sym], index: usize) -> Vec<u8> {
        let type_parameter_nodes = self.lookup_expression_chain_type_argument_nodes(chain, index);
        let symbol = chain[index];
        let symbol_name = self.name_of_symbol_as_written(symbol, index == 0);
        if matches!(symbol_name.first(), Some(b'"' | b'\''))
            && self.c.is_external_module_symbol(symbol)
        {
            let at = self.enclosing_declaration.unwrap_or(Enclosing::NONE);
            let specifier = (self.c).specifier_for_module_symbol(symbol, at, ResolutionMode::None);
            self.approximate_length += 2 + specifier.len();
            return self.string_literal(&specifier, b'"');
        }
        if index == 0 {
            self.approximate_length += 1 + symbol_name.len();
            return cat!(symbol_name, type_parameter_nodes);
        }
        let mut expression = self.create_expression_from_symbol_chain(chain, index - 1);
        let length = expression.len();
        let is_enum_member = self.c.flags_of(symbol).contains(SymFlags::ENUM_MEMBER);
        let escapes_non_ascii = !self.never_ascii_escape;
        push_access(
            &mut expression,
            &symbol_name,
            is_enum_member,
            escapes_non_ascii,
        );
        self.approximate_length += expression.len() - length;
        expression.extend(type_parameter_nodes);
        expression
    }

    /// `yieldModuleSymbol` as `symbolToTypeNode` passes it.
    fn yield_module_symbol(&self) -> YieldModuleSymbol {
        if self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0 {
            YieldModuleSymbol::Yes
        } else {
            YieldModuleSymbol::No
        }
    }

    /// `symbolToTypeNode`. `is_type_of`: the meaning is `SymbolFlagsValue`.
    fn symbol_to_type_node(
        &mut self,
        symbol: Sym,
        is_type_of: bool,
        type_arguments: Vec<Node>,
    ) -> Node {
        let meaning = if is_type_of {
            SymFlags::VALUE
        } else {
            SymFlags::TYPE
        };
        let yield_module_symbol = self.yield_module_symbol();
        let chain = self.lookup_symbol_chain(symbol, meaning, yield_module_symbol);
        self.symbol_chain_to_type_node(symbol, &chain, is_type_of, type_arguments)
    }

    /// `symbolToTypeNode`, with the meaning `SymbolFlagsValue`, for the symbol
    /// `cloneTypeAsModuleType` created from `module` for `originating_import`.
    fn module_clone_to_type_node(&mut self, module: Sym, originating_import: Sym) -> Node {
        let Some(at) = self.enclosing_declaration else {
            return self.symbol_to_type_node(module, true, Vec::new());
        };
        let clone = self.c.module_clone(originating_import);
        self.track_symbol(clone, SymFlags::VALUE);
        let yield_module_symbol = self.yield_module_symbol();
        let chain = self.c.lookup_symbol_chain_of_module_clone_at(
            originating_import,
            yield_module_symbol,
            at,
        );
        let chain = self.with_global_this(chain);
        self.symbol_chain_to_type_node(module, &chain, true, Vec::new())
    }

    /// `symbolToTypeNode`, from the point where it has the chain from `lookupSymbolChain`.
    fn symbol_chain_to_type_node(
        &mut self,
        symbol: Sym,
        chain: &[Sym],
        is_type_of: bool,
        type_arguments: Vec<Node>,
    ) -> Node {
        let type_arguments = type_arguments_text(type_arguments);
        let last = chain.len() - 1;
        if self.c.is_external_module_symbol(chain[0]) {
            let non_root_parts =
                (last > 0).then(|| self.create_access_from_symbol_chain(chain, last, 1));
            let (specifier, attributes) = self.import_type_specifier(chain[0]);
            if self.flags & ALLOW_NODE_MODULES_RELATIVE_PATHS == 0
                && attributes.is_empty()
                && bun_core::strings::contains(&specifier, b"/node_modules/")
            {
                self.encountered_error = true;
                let name = self.symbol_name(symbol).to_vec();
                self.report(Report::LikelyUnsafeImportRequired(specifier.clone(), name));
            }
            self.approximate_length += specifier.len() + 10;
            let query: &[u8] = if is_type_of { b"typeof " } else { b"" };
            let specifier = self.string_literal(&specifier, b'"');
            let import = cat!(query, b"import(", specifier, attributes, b")");
            return match non_root_parts {
                None => Node::simple(cat!(import, type_arguments)),
                Some(Access {
                    text: qualifier,
                    topmost_indexed_access: None,
                }) => Node::simple(cat!(import, b".", qualifier, type_arguments)),
                Some(Access {
                    text,
                    topmost_indexed_access: Some((object_type_end, end)),
                }) => {
                    let (qualifier, index) = text[..end].split_at(object_type_end);
                    Node::new(
                        cat!(import, b".", qualifier, type_arguments, index),
                        POSTFIX,
                    )
                }
            };
        }
        let entity_name = self.create_access_from_symbol_chain(chain, last, 0);
        // "Indexed accesses can never be `typeof`"
        if entity_name.topmost_indexed_access.is_some() {
            return Node::new(entity_name.text, POSTFIX);
        }
        if is_type_of {
            return Node::new(cat!(b"typeof ", entity_name.text), TYPE_OPERATOR);
        }
        Node {
            text: cat!(entity_name.text, type_arguments),
            precedence: NON_ARRAY,
            reference: (last == 0).then_some(entity_name.text),
            types: Vec::new(),
            in_extends: None,
        }
    }

    /// `GetSymbolNameForPrivateIdentifier(containingClass.Symbol(), description)` for `declaration`
    /// of `file`. Nothing asks for a symbol id before the binder does, so the classes it asks
    /// about are numbered from 1 in the order they are bound. `BindSourceFiles`: a
    /// `singleThreadedWorkGroup` runs what was queued last first.
    fn symbol_name_for_private_identifier(
        &self,
        file: FileId,
        declaration: Decl,
        description: &[u8],
    ) -> Vec<u8> {
        let (files, hir) = (self.c.files(), self.c.hir(file));
        let class = hir.class_of(hir.get_containing_class(hir.node(declaration)));
        let in_files_bound_before: usize = (files.order.iter())
            .skip(files.rank_of_file(file) as usize + 1)
            .map(|&later| self.c.bound(later).classes_of_private_names.len())
            .sum();
        let mut in_file = self.c.bound(file).classes_of_private_names.iter();
        let id = in_files_bound_before + in_file.position(|&it| it == class).unwrap_or(0) + 1;
        cat!(
            crate::atom::PRIVATE_NAME_PREFIX,
            itoa(&mut ItoaBuf::new(), id),
            b"@",
            description
        )
    }

    /// The text of `name`, under which a symbol table has `symbol`. Here the name of an `#x` lacks
    /// the id of the class.
    fn text_of_symbol_table_key(&self, name: Atom, symbol: Sym) -> Vec<u8> {
        let text = self.c.atoms().bytes(name);
        let declarations = self.c.files().decls_of(symbol);
        match declarations.first() {
            Some(&(file, declaration)) if text.starts_with(crate::atom::PRIVATE_NAME_PREFIX) => {
                self.symbol_name_for_private_identifier(file, declaration, &text[1..])
            }
            _ => text.to_vec(),
        }
    }

    /// The name under which `symbol` is among `getExportsOfSymbol(parent)`. Empty: it is not.
    fn name_among_exports(&mut self, parent: Sym, symbol: Sym) -> Vec<u8> {
        let (atoms, exports) = (self.c.atoms(), self.c.exports_of_symbol(parent));
        let can_name = |name: Atom| name != known::export_equals && !atoms.is_symbol_name(name);
        let own = self.c.files().symbol(symbol).name;
        if can_name(own)
            && let Some(&(_, exported)) = exports.iter().find(|export| export.0 == own)
            && self.c.is_same_reference(exported, symbol)
        {
            return self.text_of_symbol_table_key(own, symbol);
        }
        let mut results = Vec::new();
        for &(name, exported) in exports.iter() {
            if can_name(name) && self.c.is_same_reference(exported, symbol) {
                results.push((exported, name));
            }
        }
        let first = (results.into_iter()).min_by(|a, b| self.c.compare_symbols_of_chain(a.0, b.0));
        first.map_or_else(Vec::new, |(exported, name)| {
            self.text_of_symbol_table_key(name, exported)
        })
    }

    /// `k`, if the name in the first declaration of `symbol` is `[k]`.
    fn computed_entity_name(&self, symbol: Sym) -> Option<Vec<u8>> {
        let declarations = self.c.files().decls_of(symbol);
        let &(file, first) = declarations.first()?;
        let hir = self.c.hir(file);
        let key = match first {
            Decl::Member(m) => hir[m].key,
            Decl::Property(p) => hir[p].key,
            _ => return None,
        };
        match key {
            PropKey::Computed(e) if !is_parenthesized(hir, e) => match hir[e].kind {
                ExprKind::Ident(name) => Some(self.text(name)),
                _ => None,
            },
            _ => None,
        }
    }

    /// `createAccessFromSymbolChain`. The last symbol of a chain has type arguments only if it is a
    /// class, an interface or a type alias, which is no member: the caller appends those.
    fn create_access_from_symbol_chain(
        &mut self,
        chain: &[Sym],
        index: usize,
        stopper: usize,
    ) -> Access {
        let type_parameter_nodes = if index != chain.len() - 1 {
            self.lookup_type_parameter_nodes(chain, index)
        } else {
            Vec::new()
        };
        let symbol = chain[index];
        let parent = index.checked_sub(1).map(|parent| chain[parent]);
        let mut symbol_name = match parent {
            None => {
                let name = self.name_of_symbol_as_written(symbol, true);
                self.approximate_length += name.len() + 1;
                name
            }
            Some(parent) => self.name_among_exports(parent, symbol),
        };
        if symbol_name.is_empty() {
            if index > 0
                && let Some(expression) = self.computed_entity_name(symbol)
            {
                let lhs = self.create_access_from_symbol_chain(chain, index - 1, stopper);
                if lhs.topmost_indexed_access.is_some() {
                    return lhs;
                }
                let object_type = cat!(b"(typeof ", lhs.text, b")");
                let text = cat!(object_type, b"[typeof ", expression, b"]");
                return Access {
                    topmost_indexed_access: Some((object_type.len(), text.len())),
                    text,
                };
            }
            symbol_name = self.name_of_symbol_as_written(symbol, false);
        }
        self.approximate_length += symbol_name.len() + 1;
        let files = self.c.files();
        if self.flags & FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES == 0
            && let Some(parent) = parent
            && let Some(member) = files.member(parent, files.symbol(symbol).name)
            && self.c.is_same_reference(member, symbol)
        {
            let lhs = self.create_access_from_symbol_chain(chain, index - 1, stopper);
            let index_type = cat!(b"[", self.string_literal(&symbol_name, b'"'), b"]");
            let object_type = match lhs.topmost_indexed_access {
                Some(_) => lhs.text,
                None => cat!(lhs.text, type_parameter_nodes),
            };
            let text = cat!(object_type, index_type);
            return Access {
                topmost_indexed_access: (lhs.topmost_indexed_access)
                    .or(Some((object_type.len(), text.len()))),
                text,
            };
        }
        if index > stopper {
            let lhs = self.create_access_from_symbol_chain(chain, index - 1, stopper);
            return Access {
                text: cat!(lhs.text, b".", symbol_name),
                ..lhs
            };
        }
        Access {
            text: symbol_name,
            topmost_indexed_access: None,
        }
    }

    /// `getSpecifierForModuleSymbol`, and the import attributes `symbolToTypeNode` emits after it.
    fn import_type_specifier(&mut self, module: Sym) -> (Vec<u8>, Vec<u8>) {
        if let Some(at) = self.enclosing_declaration {
            let allows_node_modules_relative_paths =
                self.flags & ALLOW_NODE_MODULES_RELATIVE_PATHS != 0;
            let (specifier, mode) = self.c.import_type_specifier_and_mode(
                module,
                at,
                allows_node_modules_relative_paths,
            );
            // Empty: `paths` or `rootDirs` may affect it, which is not computed.
            if !specifier.is_empty() {
                let attributes = match mode {
                    Some(mode) => {
                        cat! { b", { with: { \"resolution-mode\": \"", mode, b"\" } }" }
                    }
                    None => Vec::new(),
                };
                return (specifier, attributes);
            }
        }
        (self.c.specifier_of_module(module), Vec::new())
    }

    // ───────────────────────────── lists of types ─────────────────────────────

    /// `mapToTypeNodes` for a list of `length` types, up to where it compares the names.
    /// `to_node`: `typeToTypeNode` of the type at an index. Also returns how many of the nodes,
    /// from the first, are not created where the list is cut.
    fn map_to_nodes(
        &mut self,
        length: usize,
        is_bare_list: bool,
        mut to_node: impl FnMut(&mut Self, usize) -> Node,
    ) -> (Vec<Node>, usize) {
        if length == 0 {
            return (Vec::new(), 0);
        }
        if self.check_truncation_length() {
            if !is_bare_list {
                return (vec![self.elision()], 0);
            }
            if length > 2 {
                let first = to_node(self, 0);
                let last = to_node(self, length - 1);
                return (vec![first, self.more_elided(length - 2), last], 0);
            }
        }
        let mut result: Vec<Node> = Vec::with_capacity(length);
        for i in 0..length {
            let display_index = i + 1;
            if self.check_truncation_length() && display_index + 2 < length - 1 {
                result.push(self.more_elided(length - display_index));
                result.push(to_node(self, length - 1));
                return (result, i);
            }
            self.approximate_length += 2;
            result.push(to_node(self, i));
        }
        (result, length)
    }

    /// `mapToTypeNodes`. Nothing for an empty list.
    fn map_to_type_nodes(&mut self, list: &[TypeId], is_bare_list: bool) -> Vec<Node> {
        let (mut result, count) = self.map_to_nodes(list.len(), is_bare_list, |printer, index| {
            printer.type_to_node(list[index])
        });
        // `mayHaveNameCollisions`
        if self.flags & USE_FULLY_QUALIFIED_TYPE != 0 {
            return result;
        }
        let mut seen_names: Vec<(&[u8], Vec<(TypeId, usize)>)> = Vec::new();
        for (i, node) in result[..count].iter().enumerate() {
            if let Some(name) = &node.reference {
                match seen_names.iter_mut().find(|seen| *seen.0 == name[..]) {
                    Some(seen) => seen.1.push((list[i], i)),
                    None => seen_names.push((&name[..], vec![(list[i], i)])),
                }
            }
        }
        let seen_names: Vec<Vec<(TypeId, usize)>> =
            (seen_names.into_iter().map(|seen| seen.1)).collect();
        // Distinct types with the same name are printed again, with their qualified names.
        let saved_flags = self.flags;
        self.flags |= USE_FULLY_QUALIFIED_TYPE;
        for types in &seen_names {
            let first = types[0].0;
            let mut is_homogeneous = true;
            for &(other, _) in &types[1..] {
                is_homogeneous &= self.are_same_reference(first, other);
            }
            if !is_homogeneous {
                for &(ty, at) in types {
                    result[at] = self.type_to_node(ty);
                }
            }
        }
        self.flags = saved_flags;
        result
    }

    /// `t.symbol` of a type that is printed as a name, as something to compare: a symbol, or the
    /// node that declares one.
    fn symbol_of_reference(&mut self, ty: TypeId) -> Option<(FileId, u32, u8)> {
        let of_symbol = |symbol: Sym| (symbol.file, symbol.id.0, 0);
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => Some(of_symbol(*target)),
            TypeData::Union(members) => self.enum_of_members(ty, members).map(of_symbol),
            TypeData::EnumLit { member, .. } => {
                self.c.files().parent_of_symbol(*member).map(of_symbol)
            }
            TypeData::Enum { symbol, .. } => Some(of_symbol(*symbol)),
            TypeData::StringMapping { kind, .. } => Some((FileId(0), *kind as u32, 6)),
            TypeData::TypeParam(file, parameter, _) => Some((*file, parameter.0, 1)),
            TypeData::Fns { decls, .. } => decls.first().map(|it| (it.0, it.1.0, 2)),
            TypeData::Synth(shape) => shape.symbol_declared_at.map(|it| (it.0, it.1, 3)),
            TypeData::Anon { origin, .. } => match *origin {
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                    Some((file, node.0, 4))
                }
                Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..) => {
                    Some((file, e.0, 5))
                }
                Origin::ClassStatic(symbol)
                | Origin::Function(symbol)
                | Origin::EnumObject(symbol)
                | Origin::Module(symbol) => Some(of_symbol(symbol)),
                Origin::Namespace {
                    originating_import, ..
                } => Some(of_symbol(originating_import)),
                Origin::GlobalThis => None,
            },
            _ => None,
        }
    }

    /// `typesAreSameReference`. `a.alias == b.alias` compares two pointers: an alias includes its
    /// type arguments. So two instantiations of an alias for a union are not the same reference.
    fn are_same_reference(&mut self, a: TypeId, b: TypeId) -> bool {
        if a == b {
            return true;
        }
        let symbol = self.symbol_of_reference(a);
        if symbol.is_some() && symbol == self.symbol_of_reference(b) {
            return true;
        }
        let alias = self.c.alias_of_type(a);
        alias.is_some() && alias == self.c.alias_of_type(b)
    }

    // ───────────────────────────── references ─────────────────────────────

    /// `getParentSymbolOfTypeParameter`: the scope that declares it represents the symbol.
    fn container_of_type_parameter(&self, parameter: TypeId) -> Option<(FileId, ScopeId)> {
        match *self.c.data(parameter) {
            TypeData::TypeParam(file, tp, _) => {
                Some((file, self.c.bound(file).type_param_scope[tp.idx()]))
            }
            _ => None,
        }
    }

    /// `symbolToTypeNode(parent, SymbolFlagsType, ..)` for the symbol that `container` represents,
    /// without the type arguments, which `appendReferenceToType` drops.
    fn container_to_type_node(&mut self, container: Option<(FileId, ScopeId)>) -> Option<Node> {
        let (file, scope) = container.filter(|container| container.1.is_some())?;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let symbol = match bound.scopes[scope.idx()].kind {
            ScopeKind::Fn(function) => match bound.fns[function.idx()].owner {
                FnOwner::Member(member) if bound.member_symbol[member.idx()].is_some() => {
                    let method = self.c.symbol_of_member(file, member);
                    return Some(self.symbol_to_type_node(method, false, Vec::new()));
                }
                FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                    Parent::Prop(p) if hir[p].kind == PropKind::Method => {
                        match bound.property_symbol.get(&Decl::Property(p)) {
                            Some(&method) => method,
                            None => return Some(self.literal_member_to_type_node(file, p)),
                        }
                    }
                    _ if hir[function].name.is_none() => {
                        let name =
                            self.name_of_anonymous_expression(file, e, b"(Anonymous function)");
                        self.approximate_length += 2 * (name.len() + 1);
                        return Some(Node::simple(name));
                    }
                    _ => bound.fn_symbol[function.idx()],
                },
                _ => bound.fn_symbol[function.idx()],
            },
            ScopeKind::Class(class) => bound.class_symbol[class.idx()],
            ScopeKind::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => SymbolId::NONE,
        };
        let symbol = symbol.is_some().then(|| self.c.files().sym(file, symbol))?;
        Some(self.symbol_to_type_node(symbol, false, Vec::new()))
    }

    /// `symbolToTypeNode(symbol, SymbolFlagsType, nil)` under `ForbidIndexedAccessSymbolReferences`
    /// for the member `p` of an object literal for which the binder has created no symbol. It is
    /// in no table, and `getContainersOfSymbol` finds the literal, which is not written, and
    /// `getVariableDeclarationOfObjectLiteral`.
    fn literal_member_to_type_node(&mut self, file: FileId, p: PropId) -> Node {
        let name = self.c.hir(file).node(p).with(Part::Name);
        let name = self.declaration_name_to_string(file, name);
        let literal = Decl::ObjectLiteral(self.c.bound(file).prop_owner[p.idx()]);
        let mut parent_chain = Vec::new();
        if (self.enclosing_declaration.is_some() || self.flags & USE_FULLY_QUALIFIED_TYPE != 0)
            && let Some(parent) = self.c.variable_declaration_of_object_literal(file, literal)
        {
            let at = self.enclosing_declaration.unwrap_or(Enclosing::NONE);
            let yield_module_symbol = self.yield_module_symbol();
            parent_chain = self.c.symbol_chain_ex(
                parent,
                at,
                Meaning::Namespace,
                yield_module_symbol,
                EndOfChain::No,
            );
        }
        let Some(&parent) = parent_chain.last() else {
            self.approximate_length += 2 * (name.len() + 1);
            return Node::simple(name);
        };
        self.approximate_length += name.len() + 1;
        let parent = self.symbol_chain_to_type_node(parent, &parent_chain, false, Vec::new());
        Node::simple(cat!(parent.text, b".", name))
    }

    /// `typeReferenceToTypeNode` for a reference to a class or an interface.
    fn type_reference_to_node(&mut self, ty: TypeId, target: Sym, args: &[TypeId]) -> Node {
        if let Some(element) = self.c.array_element(ty) {
            let is_readonly = self.c.global_type_symbol(known::ReadonlyArray) == Some(target);
            let element = self.type_to_node(element);
            let array = cat!(element.emit(POSTFIX), b"[]");
            return if is_readonly {
                Node::new(cat!(b"readonly ", array), TYPE_OPERATOR)
            } else {
                Node::new(array, POSTFIX)
            };
        }
        if self.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL != 0
            && self.c.files().flags(target).contains(SymFlags::CLASS)
            && !self.is_value_symbol_accessible(target)
        {
            return self.anonymous_type_to_node(ty);
        }
        let outer = self.c.outer_type_params_of_symbol(target);
        let all = self.c.all_type_params_of_symbol(target);
        // The groups of type arguments for the type parameters of the enclosing declarations.
        // `appendReferenceToType` keeps the names and drops the type arguments of all but the last
        // reference.
        let mut qualifier = Vec::new();
        let mut i = 0;
        while i < outer.len() && i < args.len() {
            let start = i;
            let container = self.container_of_type_parameter(outer[i]);
            i += 1;
            while i < outer.len() && self.container_of_type_parameter(outer[i]) == container {
                i += 1;
            }
            let end = i.min(args.len());
            if outer[start..end] != args[start..end] {
                self.map_to_type_nodes(&args[start..end], false);
                let saved_flags = self.flags;
                self.flags |= FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES;
                let reference = self.container_to_type_node(container);
                self.flags = saved_flags;
                if let Some(reference) = reference {
                    qualifier.extend_from_slice(&reference.text);
                    qualifier.push(b'.');
                }
            }
        }
        let mut arguments = Vec::new();
        if !args.is_empty() {
            let mut count = all.len().min(args.len());
            // Type arguments of iterables that equal their defaults are omitted.
            let is_iterable = [
                known::Iterable,
                known::IterableIterator,
                known::AsyncIterable,
                known::AsyncIterableIterator,
            ]
            .into_iter()
            .any(|name| self.c.global_type_of_arity(name, 3) == Some(target));
            // `len(t.AsTypeReference().node.TypeArguments())`
            let written = self.c.types().deferred(ty).map_or(0, |reference| {
                match self.c.hir(reference.file)[reference.node].kind {
                    TypeNodeKind::Ref { args, .. } => args.len(),
                    _ => 0,
                }
            });
            let elides = is_iterable && written < count;
            while elides && count > 0 {
                let Some(default) = self.c.default_of_type_param(all[count - 1]) else {
                    break;
                };
                if !self.c.is_identical(args[count - 1], default) {
                    break;
                }
                count -= 1;
            }
            if i < count {
                arguments = self.map_to_type_nodes(&args[i..count], false);
            }
        }
        let saved_flags = self.flags;
        self.flags |= FORBID_INDEXED_ACCESS_SYMBOL_REFERENCES;
        let mut node = self.symbol_to_type_node(target, false, arguments);
        self.flags = saved_flags;
        if !qualifier.is_empty() {
            node.text.splice(0..0, qualifier);
            node.reference = None;
        }
        node
    }

    /// `typeReferenceToTypeNode` for a tuple.
    fn tuple_to_node(&mut self, elems: &[TypeId], flags: &[ElemFlags], readonly: bool) -> Node {
        let mut types = Vec::with_capacity(elems.len());
        for (&elem, flag) in elems.iter().zip(flags) {
            types.push(
                self.c
                    .remove_missing_type(elem, flag.contains(ElemFlags::OPTIONAL)),
            );
        }
        let nodes = self.map_to_type_nodes(&types, false);
        let mut parts = Vec::with_capacity(nodes.len());
        for (i, node) in nodes.into_iter().enumerate() {
            let flag = flags.get(i).copied().unwrap_or(ElemFlags::REQUIRED);
            // `NewNamedTupleMember`
            if flag.label().is_some() {
                let dots: &[u8] = if flag.intersects(ElemFlags::REST | ElemFlags::VARIADIC) {
                    b"..."
                } else {
                    b""
                };
                let question: &[u8] = if flag.contains(ElemFlags::OPTIONAL) {
                    b"?"
                } else {
                    b""
                };
                let ty = if flag.contains(ElemFlags::REST) {
                    cat!(node.emit(POSTFIX), b"[]")
                } else {
                    node.text
                };
                parts.push(cat!(dots, self.text(flag.label()), question, b": ", ty));
                continue;
            }
            parts.push(if flag.contains(ElemFlags::REST) {
                cat!(b"...", node.emit(POSTFIX), b"[]")
            } else if flag.contains(ElemFlags::VARIADIC) {
                cat!(b"...", node.text)
            } else if flag.contains(ElemFlags::OPTIONAL) {
                cat!(node.emit(POSTFIX), b"?")
            } else {
                node.text
            });
        }
        let tuple = cat!(b"[", parts.join(&b", "[..]), b"]");
        if readonly {
            Node::new(cat!(b"readonly ", tuple), TYPE_OPERATOR)
        } else {
            Node::simple(tuple)
        }
    }

    // ───────────────────────────── type parameters ─────────────────────────────

    /// `getNameOfSymbolAsWritten(typeParameter.symbol)`
    fn name_of_type_parameter(&self, parameter: TypeId) -> Vec<u8> {
        self.c.get_symbol_id_of_type_parameter(parameter);
        if let TypeData::TypeParam(file, tp, _) = *self.c.data(parameter)
            && !self.c.is_renamed_type_param(parameter)
        {
            let hir = self.c.hir(file);
            return self.declaration_name_to_string(file, hir.name(hir.node(tp)));
        }
        match self.c.type_param_name(parameter) {
            Some(name) if name.is_some() => self.text(name),
            _ => b"?".to_vec(),
        }
    }

    /// `typeParameter.symbol`, to compare. The type parameters of the declarations of one class or
    /// interface share one symbol per name. One that `getUniqueTypeParameters` renamed has its own
    /// symbol.
    fn symbol_of_type_parameter(&self, parameter: TypeId) -> Option<(Sym, Atom)> {
        let TypeData::TypeParam(file, tp, _) = *self.c.data(parameter) else {
            return None;
        };
        let bound = self.c.bound(file);
        let scope = bound.type_param_scope[tp.idx()];
        let owner = if scope.is_none() {
            SymbolId::NONE
        } else {
            match bound.scopes[scope.idx()].kind {
                ScopeKind::Class(class) => bound.class_symbol[class.idx()],
                ScopeKind::Interface(interface) => bound.interface_symbol[interface.idx()],
                _ => SymbolId::NONE,
            }
        };
        let symbol = if owner.is_some() {
            owner
        } else {
            bound.type_param_symbol[tp.idx()]
        };
        if symbol.is_none() {
            return None;
        }
        Some((
            self.c.files().sym(file, symbol),
            self.c.type_param_name(parameter)?,
        ))
    }

    /// `typeParameterShadowsOtherTypeParameterInScope`
    fn type_parameter_shadows_other_type_parameter_in_scope(
        &self,
        name: &[u8],
        parameter: TypeId,
    ) -> bool {
        let Some(Enclosing { file, scope, .. }) = self.enclosing_declaration else {
            return false;
        };
        let found = match self
            .fake_scope_type_parameters
            .iter()
            .rev()
            .find(|local| local.0 == name)
        {
            Some(&(_, Some(found))) => found,
            Some(&(_, None)) => return true,
            None => {
                let files = self.c.files();
                let Some(found) = files
                    .atoms
                    .lookup(name)
                    .and_then(|name| files.resolve_name(file, scope, name, SymFlags::TYPE))
                else {
                    return false;
                };
                let Some(&Decl::TypeParam(tp)) = files.symbol(found).decls.first() else {
                    return false;
                };
                self.c.type_param(found.file, tp)
            }
        };
        self.symbol_of_type_parameter(found) != self.symbol_of_type_parameter(parameter)
    }

    /// `newTypeParameter(newSymbol(SymbolFlagsTypeParameter, "T"))`: a new one each time, as long
    /// as each is named before the next is created.
    fn new_type_parameter(&self, like: TypeId) -> Option<TypeId> {
        let name = self.c.atoms().intern(b"T");
        self.c
            .renamed_type_param(like, name, self.type_parameter_names.len())
    }

    /// `typeParameterToName`
    fn type_parameter_to_name(&mut self, parameter: TypeId) -> Vec<u8> {
        let raw = self.name_of_type_parameter(parameter);
        // The declaration transformer copies the nodes that are written.
        if self.flags & GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS == 0 || self.is_transformer {
            return raw;
        }
        if let Some(named) = self
            .type_parameter_names
            .iter()
            .rev()
            .find(|named| named.0 == parameter)
        {
            return named.1.clone();
        }
        let mut count = self
            .type_parameter_name_counts
            .iter()
            .rev()
            .find(|next| next.0 == raw)
            .map_or(0, |next| next.1);
        let mut text = raw.clone();
        while self
            .type_parameter_names
            .iter()
            .any(|named| named.1 == text)
            || self.type_parameter_shadows_other_type_parameter_in_scope(&text, parameter)
        {
            count += 1;
            text = cat!(raw, b"_", itoa(&mut ItoaBuf::new(), count));
        }
        self.type_parameter_name_counts.push((raw, count));
        self.type_parameter_names.push((parameter, text.clone()));
        text
    }

    /// `enterNewScope`. Pass the result to `leave_scope`.
    fn enter_new_scope(
        &mut self,
        expanded_parameters: &[Option<(FileId, ParamId)>],
        type_parameters: &[TypeId],
        original_parameters: Option<&[Option<(FileId, ParamId)>]>,
        is_instantiated: bool,
    ) -> OuterScope {
        let outer = OuterScope {
            type_parameter_names: self.type_parameter_names.len(),
            type_parameter_name_counts: self.type_parameter_name_counts.len(),
            type_parameter_symbol_list: self.type_parameter_symbol_list.len(),
            fake_scope_type_parameters: self.fake_scope_type_parameters.len(),
            fake_scope_parameters: self.fake_scope_parameters.len(),
            enclosing_declaration: self.enclosing_declaration,
            has_fake_scope: self.has_fake_scope,
            mapper: self.mapper,
        };
        // `pushFakeScope("params", ..)`, which encloses that of the type parameters.
        if expanded_parameters.iter().any(Option::is_some) {
            self.push_fake_scope(0);
        }
        if self.enclosing_declaration.is_some() {
            for (index, &parameter) in expanded_parameters.iter().enumerate() {
                let original = original_parameters.and_then(|list| list.get(index).copied()?);
                let is_expanded = original_parameters.is_some() && original != parameter;
                let Some((file, declaration)) = (if is_expanded { original } else { parameter })
                else {
                    continue;
                };
                let (hir, bound) = (self.c.hir(file), self.c.bound(file));
                let mut pat = hir[declaration].pat;
                // `bindPattern` goes no further than the first element.
                while !is_expanded
                    && let Some(first) = match hir[pat].kind {
                        PatKind::Object(props) if !props.is_empty() => Some(hir[props.at(0)].value),
                        PatKind::Array(elems) if !elems.is_empty() => Some(hir[elems.at(0)].pat),
                        _ => None,
                    }
                {
                    pat = first;
                }
                if let PatKind::Ident(name) = hir[pat].kind
                    && bound.pat_symbol[pat.idx()].is_some()
                {
                    let symbol = self.c.files().sym(file, bound.pat_symbol[pat.idx()]);
                    // `instantiateSymbol` returns the symbol itself if its type cannot contain type
                    // variables. `bindPattern` adds the symbols of the declarations.
                    let is_declared_symbol = !is_instantiated || pat != hir[declaration].pat || {
                        let declared = self.c.type_of_pat(file, pat);
                        !self.c.types().object_flags(declared).intersects(
                            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                                | ObjectFlags::HAS_REVERSE_MAPPED,
                        )
                    };
                    self.fake_scope_parameters
                        .push((name, is_declared_symbol.then_some(symbol)));
                }
            }
            for &type_parameter in type_parameters {
                let TypeData::TypeParam(file, tp, _) = *self.c.data(type_parameter) else {
                    continue;
                };
                let bound = self.c.bound(file);
                let symbol = bound.type_param_symbol[tp.idx()];
                if symbol.is_some()
                    && bound.symbols[symbol.idx()]
                        .flags
                        .contains(SymFlags::PARAMETER)
                {
                    let name = self.text(self.c.hir(file)[tp].name);
                    self.fake_scope_type_parameters
                        .push((name, (!is_instantiated).then_some(type_parameter)));
                }
            }
        }
        if self.enclosing_declaration.is_some()
            && self.flags & GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS != 0
        {
            if !type_parameters.is_empty() {
                self.push_fake_scope(1);
            }
            for &parameter in type_parameters {
                let name = self.type_parameter_to_name(parameter);
                self.fake_scope_type_parameters
                    .push((name, Some(parameter)));
            }
        }
        outer
    }

    /// `pushFakeScope`, where it creates a block. An existing block of the same kind is reused by
    /// whatever is printed inside it.
    fn push_fake_scope(&mut self, kind: usize) {
        if let Some(enclosing_declaration) = &mut self.enclosing_declaration
            && !self.has_fake_scope[kind]
        {
            self.has_fake_scope[kind] = true;
            self.fake_scope_count += 1;
            enclosing_declaration.fake_scope = self.fake_scope_count;
        }
    }

    fn leave_scope(&mut self, outer: &OuterScope) {
        self.type_parameter_names
            .truncate(outer.type_parameter_names);
        self.type_parameter_name_counts
            .truncate(outer.type_parameter_name_counts);
        self.type_parameter_symbol_list
            .truncate(outer.type_parameter_symbol_list);
        self.fake_scope_type_parameters
            .truncate(outer.fake_scope_type_parameters);
        self.fake_scope_parameters
            .truncate(outer.fake_scope_parameters);
        self.enclosing_declaration = outer.enclosing_declaration;
        self.has_fake_scope = outer.has_fake_scope;
        self.mapper = outer.mapper;
    }

    /// A type parameter where it is used: its name, or `infer T` in the `extends` type that declares it.
    fn type_parameter_to_node(&mut self, ty: TypeId) -> Node {
        let name = self.type_parameter_to_name(ty);
        if !self.infer_type_parameters.contains(&ty) {
            self.approximate_length += match self.flags & GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS {
                // `symbolToTypeNode`
                0 => 2 * (name.len() + 1),
                _ => name.len(),
            };
            return Node {
                text: name.clone(),
                precedence: NON_ARRAY,
                reference: Some(name),
                types: Vec::new(),
                in_extends: None,
            };
        }
        self.approximate_length += name.len() + 6;
        // A constraint implied by the position of `infer T` is omitted.
        if let Some(constraint) = self.c.constraint_of_type_param(ty) {
            let inferred = match *self.c.data(ty) {
                TypeData::TypeParam(file, tp, _) => {
                    self.c.inferred_type_param_constraint(ty, file, tp, true)
                }
                _ => None,
            };
            let is_implied =
                inferred.is_some_and(|inferred| self.c.is_identical(constraint, inferred));
            if !is_implied {
                self.approximate_length += 9;
                let constraint = self.type_to_node(constraint);
                return Node::new(
                    cat!(b"infer ", name, b" extends ", constraint.emit_in_extends()),
                    FUNCTION,
                );
            }
        }
        Node::new(cat!(b"infer ", name), TYPE_OPERATOR)
    }

    /// The constraint of `parameter` in its declaration.
    /// `typeToTypeNodeHelperWithPossibleReusableTypeNode`: the declared syntax is reused if it
    /// still resolves to the same type.
    /// `clones`: type parameters that map to clones of themselves (`has_inference_context`).
    fn constraint_to_node(
        &mut self,
        parameter: TypeId,
        constraint: TypeId,
        clones: &[TypeId],
    ) -> Node {
        if let TypeData::TypeParam(file, tp, _) = *self.c.data(parameter) {
            let written = self.c.hir(file)[tp].constraint;
            if written.is_some()
                && !clones
                    .iter()
                    .any(|&clone| self.c.mentions(constraint, clone))
            {
                let declared = self.c.type_from_node(file, written);
                if self.c.instantiate(declared, self.mapper) == constraint {
                    return self.reuse_type_node(file, written);
                }
            }
        }
        self.type_to_node(constraint)
    }

    /// `typeParameterToDeclaration`
    fn type_parameter_declaration(&mut self, parameter: TypeId, clones: &[TypeId]) -> Vec<u8> {
        // `getConstraintOfTypeParameter`. Here `computeBaseConstraint` itself calls
        // `constraint_of_type_param`, which detects a cycle only through type parameters, unions
        // and intersections.
        let constraint = match self.c.constraint_of_type_param(parameter) {
            Some(constraint) if self.c.has_non_circular_base_constraint(parameter) => {
                Some(self.constraint_to_node(parameter, constraint, clones).text)
            }
            _ => None,
        };
        // `typeParameterToDeclarationWithConstraint`
        let saved_flags = self.flags;
        self.flags &= !WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME;
        let mut text = Vec::new();
        // `getTypeParameterModifiers`
        if !self.c.is_renamed_type_param(parameter)
            && let Some((_, declaration)) = self.c.type_param_decl(parameter)
        {
            for (flag, modifier) in [
                (Flags::CONST, &b"const "[..]),
                (Flags::IN, &b"in "[..]),
                (Flags::OUT, &b"out "[..]),
            ] {
                if declaration.flags.contains(flag) {
                    text.extend_from_slice(modifier);
                }
            }
        }
        text.extend_from_slice(&self.type_parameter_to_name(parameter));
        if let Some(constraint) = constraint {
            text.extend_from_slice(b" extends ");
            text.extend_from_slice(&constraint);
        }
        if let Some(default) = self.c.default_of_type_param(parameter) {
            let default = self.type_to_node(default);
            text.extend_from_slice(b" = ");
            text.extend_from_slice(&default.text);
        }
        self.flags = saved_flags;
        text
    }

    // ───────────────────────────── unions and intersections ─────────────────────────────

    fn union_to_node(&mut self, ty: TypeId) -> Node {
        // `UnionType.origin` is printed instead.
        match self.c.origin(ty) {
            UnionOrigin::Keyof(of) => {
                self.approximate_length += 6;
                let of = self.type_to_node(*of);
                return Node::new(cat!(b"keyof ", of.emit(TYPE_OPERATOR)), TYPE_OPERATOR);
            }
            UnionOrigin::Intersection(origin) => return self.intersection_to_node(origin),
            UnionOrigin::Union(_) | UnionOrigin::None => {}
        }
        let types = self.format_union_types(ty);
        if let [only] = types[..] {
            return self.type_to_node(only);
        }
        let nodes = self.map_to_type_nodes(&types, true);
        Node::union(nodes)
    }

    fn intersection_to_node(&mut self, members: &[TypeId]) -> Node {
        if let [only] = members[..] {
            return self.type_to_node(only);
        }
        let nodes = self.map_to_type_nodes(members, true);
        Node::new(join_nodes(nodes, b" & ", TYPE_OPERATOR), INTERSECTION)
    }

    /// `formatUnionTypes` for the members of `ty` in TypeScript's order.
    fn format_union_types(&mut self, ty: TypeId) -> Vec<TypeId> {
        let types = match self.c.origin(ty) {
            UnionOrigin::Union(origin) => &origin[..],
            _ => self.c.parts(ty),
        };
        let mut result = Vec::with_capacity(types.len());
        let (mut has_null, mut has_undefined) = (false, false);
        let mut i = 0;
        while i < types.len() {
            let member = types[i];
            i += 1;
            if member.is_undefined() {
                has_undefined = true;
                continue;
            }
            if member.is_null() {
                has_null = true;
                continue;
            }
            let base = match *self.c.data(member) {
                TypeData::BoolLit { .. } => Some(TypeId::BOOLEAN),
                TypeData::EnumLit { member: symbol, .. } | TypeData::Enum { symbol, .. } => {
                    Some(self.c.enum_type_of_member(symbol))
                }
                _ => None,
            };
            // All the members of `boolean` or of an enum, which are adjacent, are printed as one.
            if let Some(base) = base.filter(|&base| self.c.is_union(base)) {
                let all = self.c.parts(base);
                let last = i - 1 + all.len() - 1;
                if last < types.len()
                    && self.c.regular(types[last]) == self.c.regular(all[all.len() - 1])
                {
                    result.push(base);
                    i = last + 1;
                    continue;
                }
            }
            result.push(member);
        }
        if has_null {
            result.push(TypeId::NULL);
        }
        if has_undefined {
            result.push(TypeId::UNDEFINED);
        }
        result
    }

    // ───────────────────────────── anonymous object types ─────────────────────────────

    /// `isNonLocalFunctionSymbol` for a declared function.
    fn is_non_local_function(&self, function: Sym) -> bool {
        let files = self.c.files();
        files.symbol(function).parent.is_some()
            || files
                .decls(function)
                .into_iter()
                .any(|(file, decl)| match decl {
                    Decl::Fn(f) => {
                        let bound = self.c.bound(file);
                        match bound.fns[f.idx()].owner {
                            FnOwner::Stmt(statement) => matches!(
                                bound.stmt_parent[statement.idx()],
                                Parent::File | Parent::Module(_)
                            ),
                            _ => false,
                        }
                    }
                    _ => false,
                })
    }

    /// `shouldEmitTypeOfSymbol`: the symbol by which `typeof` names the type `ty` of `origin`.
    fn symbol_to_query(&mut self, ty: TypeId, origin: Origin) -> Option<Sym> {
        let symbol = match origin {
            Origin::ClassStatic(symbol)
            | Origin::EnumObject(symbol)
            | Origin::Module(symbol)
            | Origin::Function(symbol)
            | Origin::Namespace { module: symbol, .. } => symbol,
            _ => return None,
        };
        if self.should_emit_type_of_symbol(symbol, SymFlags::VALUE) {
            return Some(symbol);
        }
        // `shouldWriteTypeOfFunctionSymbol`
        (self.c.files().flags(symbol).contains(SymFlags::FUNCTION)
            && self.is_non_local_function(symbol)
            && (self.flags & USE_TYPE_OF_FUNCTION != 0 || self.visited_types.contains(&ty))
            && (self.flags & USE_STRUCTURAL_FALLBACK == 0
                || self.is_value_symbol_accessible(symbol)))
        .then_some(symbol)
    }

    /// `shouldEmitTypeOfSymbol`, up to its call of `shouldWriteTypeOfFunctionSymbol`. `meaning`:
    /// `isInstanceType`.
    fn should_emit_type_of_symbol(&mut self, symbol: Sym, meaning: SymFlags) -> bool {
        let flags = self.c.files().flags(symbol);
        if flags.intersects(SymFlags::ENUM | SymFlags::VALUE_MODULE) {
            return true;
        }
        if !flags.contains(SymFlags::CLASS) || self.c.base_type_variable_of_class(symbol).is_some()
        {
            return false;
        }
        if self.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL == 0 {
            return true;
        }
        // `ast.IsClassDeclaration(symbol.ValueDeclaration)`
        let is_class_declaration = self.c.files().decls(symbol).iter().any(|&(file, decl)| {
            matches!(decl, Decl::Class(c)
                if matches!(self.c.bound(file).class_owner[c.idx()], ClassOwner::Stmt(_)))
        });
        is_class_declaration && self.is_symbol_accessible(symbol, meaning)
    }

    /// The same for a function expression that initializes a variable at the top level of a file or
    /// a namespace: the variable. If that is the enclosing declaration, the function expression
    /// itself. Also returns whether it is unnamed, so nothing can refer to it: then the symbol is
    /// that of the variable anyway.
    fn variable_of_function_expression(&self, ty: TypeId) -> Option<(Sym, bool)> {
        let TypeData::Fns { decls, .. } = self.c.data(ty) else {
            return None;
        };
        let &(file, func) = decls.first()?;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let FnOwner::Expr(e) = bound.fns[func.idx()].owner else {
            return None;
        };
        let Parent::VarInit(declaration) = bound.expr_parent[e.idx()] else {
            return None;
        };
        let statement = bound.var_stmt[declaration.idx()];
        if is_parenthesized(hir, e)
            || statement.is_none()
            || !matches!(
                bound.stmt_parent[statement.idx()],
                Parent::File | Parent::Module(_)
            )
        {
            return None;
        }
        // `symbol.ValueDeclaration.Parent != b.ctx.enclosingDeclaration`
        let own = bound.fn_symbol[func.idx()];
        let is_itself = self
            .enclosing_declaration
            .is_some_and(|at| (at.file, at.variable) == (file, declaration));
        let symbol = if is_itself && own.is_some() {
            own
        } else {
            bound.pat_symbol[hir[declaration].pat.idx()]
        };
        symbol
            .is_some()
            .then(|| (self.c.files().sym(file, symbol), is_itself && own.is_none()))
    }

    /// `isLateBindableIndexSignature` for the name `key` of a member of `file`.
    fn is_late_bindable_index_signature(&mut self, file: FileId, key: PropKey) -> bool {
        let PropKey::Computed(name) = key else {
            return false;
        };
        // `isLateBindableAST`
        if !is_entity_name_expression(self.c.hir(file), name) {
            return false;
        }
        let ty = self.c.type_of_expr(file, name);
        let string_number_symbol = [TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL];
        let string_number_symbol = self.c.union(&string_number_symbol);
        self.c.is_assignable(ty, string_number_symbol)
    }

    /// `isStaticMethodSymbol`: the symbol of the method `ty` is the type of, if that is static.
    fn static_method_symbol(&mut self, ty: TypeId) -> Option<Sym> {
        let TypeData::Fns { decls, .. } = self.c.data(ty) else {
            return None;
        };
        for &(file, func) in decls.iter() {
            let bound = self.c.bound(file);
            let FnOwner::Member(m) = bound.fns[func.idx()].owner else {
                return None;
            };
            let member = &self.c.hir(file)[m];
            if member.kind == MemberKind::Method
                && member.flags.contains(Flags::STATIC)
                && bound.member_symbol[m.idx()].is_some()
                && !self.is_late_bindable_index_signature(file, member.key)
            {
                return Some(self.c.symbol_of_member(file, m));
            }
        }
        None
    }

    /// `shouldWriteTypeOfFunctionSymbol` for the symbol of the method or the function expression
    /// `ty` is the type of: the symbol to write.
    fn should_write_type_of_function_symbol(&mut self, ty: TypeId) -> Option<Sym> {
        if self.flags & USE_TYPE_OF_FUNCTION == 0 && !self.visited_types.contains(&ty) {
            return None;
        }
        let (symbol, is_anonymous) = match self.static_method_symbol(ty) {
            Some(method) => (method, false),
            None => self.variable_of_function_expression(ty)?,
        };
        (self.flags & USE_STRUCTURAL_FALLBACK == 0
            || !is_anonymous && self.is_value_symbol_accessible(symbol))
        .then_some(symbol)
    }

    /// `createAnonymousTypeNode`
    fn anonymous_type_to_node(&mut self, ty: TypeId) -> Node {
        // `createAnonymousTypeNodeEx`: "Anonymous types without a symbol are never circular."
        if matches!(self.c.data(ty), TypeData::ReverseMapped { .. }) {
            return self.object_type_to_node(ty);
        }
        // An `InstantiationExpressionType` that is the type of its type query is printed as that
        // query.
        if let TypeData::Synth(shape) = self.c.data(ty)
            && let Some(InstantiationExpression::TypeNode(file, node)) =
                shape.instantiation_expression
            && matches!(self.c.hir(file)[node].kind, TypeNodeKind::Typeof { .. })
        {
            let declared = self.c.type_from_node(file, node);
            if self.c.instantiate(declared, self.mapper) == ty {
                // A query whose name cannot be used here is printed from its type, which re-enters
                // here.
                if self.visited_types.contains(&ty) {
                    return self.elided_information_placeholder();
                }
                self.visited_types.push(ty);
                // `tryReuseExistingNonParameterTypeNode`: `getTypeFromTypeNode(existing, true)` is
                // nil if the mapper changes the type.
                let reused = match declared == ty {
                    true => self.try_reuse_type_node(file, node),
                    false => None,
                };
                self.visited_types.retain(|&visited| visited != ty);
                if let Some(reused) = reused {
                    return reused;
                }
            }
        }
        let identity = match self.c.data(ty) {
            TypeData::Anon { origin, .. } => {
                let origin = *origin;
                if origin == Origin::GlobalThis {
                    let global_this = self.c.files().global_this_symbol;
                    return self.symbol_to_type_node(global_this, true, Vec::new());
                }
                if let Some(symbol) = self.symbol_to_query(ty, origin) {
                    if let Origin::Namespace {
                        originating_import, ..
                    } = origin
                    {
                        return self.module_clone_to_type_node(symbol, originating_import);
                    }
                    return self.symbol_to_type_node(symbol, true, Vec::new());
                }
                // An object literal is one symbol, fresh, regular or widened.
                Identity::Origin(match origin {
                    Origin::ObjectLiteral(file, literal, ..)
                    | Origin::WidenedLiteral(file, literal, ..) => {
                        Origin::WidenedLiteral(file, literal, false, false, false)
                    }
                    _ => origin,
                })
            }
            TypeData::Fns { decls, .. } => match decls.first() {
                Some(&(file, func)) => Identity::Function(file, func),
                None => Identity::Type(ty),
            },
            // The instance side of a class.
            TypeData::Ref { target, .. } => {
                let target = *target;
                if self.should_emit_type_of_symbol(target, SymFlags::TYPE) {
                    return self.symbol_to_type_node(target, false, Vec::new());
                }
                Identity::Instance(target)
            }
            _ => Identity::Type(ty),
        };
        if let Some(symbol) = self.should_write_type_of_function_symbol(ty) {
            return self.symbol_to_type_node(symbol, true, Vec::new());
        }
        if self.visited_types.contains(&ty) {
            if self.enclosing_declaration.is_some()
                && let Some(alias) = self.type_alias_for_type_literal(ty)
            {
                return self.symbol_to_type_node(alias, false, Vec::new());
            }
            return self.elided_information_placeholder();
        }
        self.visit_and_transform_type(ty, Some(identity), Self::object_type_to_node)
    }

    /// `createTypeNodeFromObjectType`
    fn object_type_to_node(&mut self, ty: TypeId) -> Node {
        let with_errors = &self.c.p.mapped_types_with_errors;
        if self.c.mapped_origin(ty).is_some()
            && (self.c.is_generic(ty) || with_errors.get(&self.c.task, &ty).is_some())
        {
            return self.mapped_type_to_node(ty);
        }
        let Some(members) = self.c.members(ty) else {
            self.approximate_length += 2;
            return Node::simple(b"{}");
        };
        let (shape, mapper) = (members.shape(), members.mapper);
        let mut call = Vec::with_capacity(shape.call.len());
        for &signature in &shape.call {
            call.push(self.c.instantiate_sig(signature, mapper));
        }
        let mut construct = Vec::with_capacity(shape.construct.len());
        for &signature in &shape.construct {
            construct.push(self.c.instantiate_sig(signature, mapper));
        }
        if shape.props.is_empty() && shape.index.is_empty() {
            match (&call[..], &construct[..]) {
                ([], []) => {
                    self.approximate_length += 2;
                    return Node::simple(b"{}");
                }
                ([only], []) => return self.signature_to_node(*only, SignatureKind::FunctionType),
                ([], [only]) => {
                    return self.signature_to_node(*only, SignatureKind::ConstructorType);
                }
                _ => {}
            }
        }
        // `getNamedMembers`: what a class declares precedes what it inherits. Its shape has that
        // order.
        let properties: Vec<Prop<'s>> = match self.c.data(ty) {
            TypeData::Ref { .. }
            | TypeData::Anon {
                origin: Origin::ClassStatic(_),
                ..
            } => {
                let arena = self.c.arena;
                (shape.props.iter().map(|prop| prop.clone_in(arena))).collect()
            }
            _ => self.ordered_properties(&shape.props),
        };
        let (abstract_signatures, construct): (Vec<SigId>, Vec<SigId>) = construct
            .into_iter()
            .partition(|&signature| self.c.is_abstract_signature(signature));
        if abstract_signatures.is_empty() {
            return self.type_literal_to_node(
                ty,
                &call,
                &construct,
                &shape.index,
                &properties,
                mapper,
            );
        }
        let property_count = if self.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL != 0 {
            properties
                .iter()
                .filter(|property| !self.is_prototype_property(ty, property))
                .count()
        } else {
            properties.len()
        };
        let type_element_count = call.len() + construct.len() + shape.index.len() + property_count;
        // `typeToTypeNode(getIntersectionType(types))`: `abstract new () => T` cannot appear in a
        // type literal. No type is created here for a signature, nor for the rest.
        let to_node = |printer: &mut Self, index: usize| match abstract_signatures.get(index) {
            Some(&signature) => {
                printer.signature_to_node(signature, SignatureKind::ConstructorType)
            }
            None => printer.type_literal_to_node(
                ty,
                &call,
                &construct,
                &shape.index,
                &properties,
                mapper,
            ),
        };
        let count = abstract_signatures.len() + usize::from(type_element_count != 0);
        if count == 1 {
            return to_node(self, 0);
        }
        let nodes = self.map_to_nodes(count, true, to_node).0;
        Node::new(join_nodes(nodes, b" & ", TYPE_OPERATOR), INTERSECTION)
    }

    /// `propertySymbol.Flags&SymbolFlagsPrototype != 0` for a property of `owner`.
    fn is_prototype_property(&self, owner: TypeId, property: &Prop) -> bool {
        property.name == known::prototype
            && matches!(property.source, PropSource::Type(_))
            && matches!(
                self.c.data(owner),
                TypeData::Anon {
                    origin: Origin::ClassStatic(_),
                    ..
                }
            )
    }

    fn type_literal_to_node(
        &mut self,
        ty: TypeId,
        call: &[SigId],
        construct: &[SigId],
        index: &[IndexInfo],
        properties: &[Prop],
        mapper: MapperId,
    ) -> Node {
        let saved_flags = self.flags;
        self.flags |= IN_OBJECT_TYPE_LITERAL;
        let outer = self.indent_members();
        let elements = self.type_elements(ty, call, construct, index, properties, mapper);
        self.indent = outer;
        self.flags = saved_flags;
        self.approximate_length += 2;
        if elements.is_empty() {
            Node::simple(b"{}")
        } else {
            Node::simple(self.braces(&elements))
        }
    }

    /// `setCommentRange(node, propertySymbol.ValueDeclaration)`. A property of a mapped type has `Declarations` and no `ValueDeclaration`.
    fn comments_of_value_declaration(&mut self, prop: &Prop) -> Vec<u8> {
        let has_value_declaration = match prop.source {
            PropSource::Symbol(_) | PropSource::Literal(..) => true,
            PropSource::Copy(_, _, has_value_declaration) => has_value_declaration,
            _ => false,
        };
        match self.value_declaration_of_property(prop) {
            Some((file, declaration)) if has_value_declaration && self.indent.is_some() => {
                // Among assignment declarations it is the first, annotated or not.
                let first = match first_declared(prop).map(|declared| &declared.source) {
                    Some(PropSource::Symbol(symbol)) => self.c.files().value_declaration(*symbol),
                    _ => None,
                };
                match first {
                    Some((file, Decl::Expando(first) | Decl::ThisProperty(first))) => {
                        self.comments_before(file, self.c.hir(file).node(first))
                    }
                    _ => self.comments_before(file, declaration),
                }
            }
            _ => Vec::new(),
        }
    }

    /// `preservePartialJsDoc`, and the printer's output for the synthetic comment: the comment of
    /// the tag from which the member `m` of a type literal is synthesized.
    pub(super) fn partial_jsdoc(&self, file: FileId, m: MemberId) -> Vec<u8> {
        let description = self.c.hir(file).jsdoc_comment_of_member(m);
        let Some(indent) = self
            .indent
            .filter(|_| self.is_transformer && !description.is_empty())
        else {
            return Vec::new();
        };
        if self.c.files().options.remove_comments {
            return Vec::new();
        }
        let margin = b"    ".repeat(indent);
        let mut text = b"/**\n".to_vec();
        for line in bun_core::strings::split(description, b"\n") {
            text.extend_from_slice(&cat!(margin, b" * ", line, b"\n"));
        }
        text.extend_from_slice(&cat!(margin, b" */\n", margin));
        text
    }

    /// `setCommentRange`, and the printer's output for it: the comments before the declaration
    /// `node` of `file`, if a declaration file is emitted for `file`.
    pub(super) fn comments_before(&self, file: FileId, node: hir::Node) -> Vec<u8> {
        let Some(indent) = self.indent else {
            return Vec::new();
        };
        if self.c.files().options.remove_comments
            || self.enclosing_declaration.is_none_or(|it| it.file != file)
        {
            return Vec::new();
        }
        let Some(pos) = self.pos_of_declaration(file, node) else {
            return Vec::new();
        };
        let hir = self.c.hir(file);
        let comments = super::spans::get_leading_comment_ranges(&hir.text, pos as usize);
        super::errors_declaration_emit::comments_text(&hir.text, comments, indent)
    }

    /// `shouldEmitComments` for the nodes of `file` that the declaration transformer reuses.
    fn should_emit_comments(&self, file: FileId) -> bool {
        self.is_transformer
            && !self.c.files().options.remove_comments
            && self.enclosing_declaration.is_some_and(|it| it.file == file)
    }

    /// `node.Pos()`, which is before the leading trivia, of a member, a parameter, a property of
    /// an object literal or an expression.
    pub(super) fn pos_of_declaration(&self, file: FileId, node: hir::Node) -> Option<u32> {
        let hir = self.c.hir(file);
        match hir.data(node) {
            NodeData::Member(m) => Some(hir[m].loc.pos),
            NodeData::Param(p) => (hir[p].loc.end != 0).then_some(hir[p].loc.pos),
            // The end of the `{` or the comma before it.
            NodeData::Prop(p) => match hir[self.c.bound(file).prop_owner[p.idx()]] {
                Expr {
                    kind: ExprKind::Object(props),
                    pos,
                    ..
                } if props.at(0) == p => Some(pos + 1),
                Expr {
                    kind: ExprKind::Object(_),
                    ..
                } => {
                    let comma = self.c.skip_trivia_from(file, hir[PropId(p.0 - 1)].end);
                    (hir.text.get(comma as usize) == Some(&b',')).then_some(comma + 1)
                }
                _ => None,
            },
            // An assignment declaration.
            NodeData::Expr(_) => {
                let start = hir.start(node) as usize;
                Some(super::errors_declaration_emit::pos_before(&hir.text, start) as u32)
            }
            _ => None,
        }
    }

    /// Everything printed from now on is a member of a type literal. The result is restored to
    /// `indent` once they are printed.
    fn indent_members(&mut self) -> Option<usize> {
        let outer = self.indent;
        self.indent = outer.map(|level| level + 1);
        outer
    }

    /// `emitTypeLiteral`: `SingleLineTypeLiteralMembers`, or `MultiLineTypeLiteralMembers`.
    fn braces(&self, members: &[Vec<u8>]) -> Vec<u8> {
        let Some(level) = self.indent else {
            return cat!(b"{ ", members.join(&b" "[..]), b" }");
        };
        let mut text = b"{\n".to_vec();
        for member in members {
            text.extend_from_slice(&b"    ".repeat(level + 1));
            text.extend_from_slice(member);
            text.push(b'\n');
        }
        text.extend_from_slice(&b"    ".repeat(level));
        text.push(b'}');
        text
    }

    /// `createTypeNodesFromResolvedType`
    fn type_elements(
        &mut self,
        ty: TypeId,
        call: &[SigId],
        construct: &[SigId],
        index: &[IndexInfo],
        properties: &[Prop],
        mapper: MapperId,
    ) -> Vec<Vec<u8>> {
        let no_truncation = self.flags & NO_TRUNCATION != 0;
        if self.check_truncation_length() {
            // `NewNotEmittedTypeElement`: one element, which prints as nothing.
            return if no_truncation {
                vec![Vec::new()]
            } else {
                vec![b"...;".to_vec()]
            };
        }
        let mut elements = Vec::new();
        for &signature in call {
            let text = self.signature_to_text(signature, SignatureKind::Call, b"", false);
            elements.push(cat!(text, b";"));
        }
        for &signature in construct {
            let text = self.signature_to_text(signature, SignatureKind::Construct, b"", false);
            elements.push(cat!(text, b";"));
        }
        let is_reverse_mapped = matches!(self.c.data(ty), TypeData::ReverseMapped { .. });
        for info in index {
            // The placeholder is created whether or not it is used.
            let placeholder = self.elided_information_placeholder();
            let type_node = is_reverse_mapped.then_some(&placeholder);
            if let Some(names) = self.index_info_to_object_computed_names(info, type_node) {
                elements.extend(names);
                continue;
            }
            let name = self.get_name_from_index_info(info);
            let key = self.c.instantiate(info.key, mapper);
            let key = self.type_to_node(key);
            let value = if is_reverse_mapped {
                placeholder
            } else {
                let value = self.c.instantiate(info.value, mapper);
                self.type_to_node(value)
            };
            self.approximate_length += name.len() + 4;
            let modifier: &[u8] = if info.readonly {
                self.approximate_length += 9;
                b"readonly "
            } else {
                b""
            };
            elements.push(cat! { modifier, b"[", name, b": ", key.text, b"]: ", value.text, b";" });
        }
        for (i, property) in properties.iter().enumerate() {
            if self.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL != 0 {
                if self.is_prototype_property(ty, property) {
                    continue;
                }
                if property
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                {
                    let name = self.text(property.name);
                    self.report(Report::PrivateInBaseOfClassExpression(name));
                }
                if self.c.is_private_identifier_symbol(property.name) {
                    let name = self.c.written_name(property.name);
                    self.report(Report::PrivateInBaseOfClassExpression(name.to_vec()));
                }
            }
            if self.check_truncation_length() && i + 1 + 2 < properties.len() - 1 {
                if !no_truncation {
                    elements.push(cat! {
                        b"... ", itoa(&mut ItoaBuf::new(), properties.len() - (i + 1)),
                        b" more ...;"
                    });
                }
                let last = &properties[properties.len() - 1];
                self.add_property_to_element_list(ty, last, mapper, &mut elements);
                break;
            }
            self.add_property_to_element_list(ty, property, mapper, &mut elements);
        }
        elements
    }

    /// `getNameFromIndexInfo`
    fn get_name_from_index_info(&self, info: &IndexInfo) -> Vec<u8> {
        let Some((file, member)) = info.declaration else {
            return b"x".to_vec();
        };
        let hir = self.c.hir(file);
        let parameter = &hir[hir[hir[member].func].params.at(0)];
        match hir[parameter.pat].kind {
            PatKind::Ident(name) => self.text(name),
            _ => b"(Missing)".to_vec(),
        }
    }

    /// `indexInfoToObjectComputedNamesOrSignatureDeclaration`: the property signatures printed for
    /// `info.components`. `None`: the index signature is printed instead
    /// (`indexInfoToIndexSignatureDeclarationHelper`). `type_node`: the node printed for the type
    /// of each, if not its own type.
    fn index_info_to_object_computed_names(
        &mut self,
        info: &IndexInfo,
        type_node: Option<&Node>,
    ) -> Option<Vec<Vec<u8>>> {
        let components = self.c.index_components(info.components);
        let at = self.enclosing_declaration?;
        if components.is_empty() {
            return None;
        }
        let mut names = Vec::with_capacity(components.len());
        for &component in components {
            let (file, key) = self.c.name_of_index_component(component);
            let PropKey::Computed(name) = key else {
                return None;
            };
            if !self
                .c
                .is_trivially_serializable_computed_name_at(file, name, at)
            {
                return None;
            }
            names.push((component, file, name));
        }
        let modifier: &[u8] = if info.readonly { b"readonly " } else { b"" };
        let mut results = Vec::new();
        let mut bailed = false;
        for (component, file, expression) in names {
            // `hasLateBindableName`
            if (self.c.member_name(file, PropKey::Computed(expression))).is_some() {
                continue;
            }
            let Some(name) = self.reuse_computed_property_name(file, expression) else {
                bailed = true;
                continue;
            };
            self.track_computed_name(file, expression);
            // `e.PostfixToken()`
            let postfix_token: &[u8] = match component {
                IndexComponent::Property(file, p) => {
                    let hir = self.c.hir(file);
                    match hir[p].postfix_token {
                        0 => b"",
                        at if hir.text.get(at as usize) == Some(&b'!') => b"!",
                        _ => b"?",
                    }
                }
                IndexComponent::Member(file, m) => {
                    let flags = self.c.hir(file)[m].flags;
                    if flags.contains(Flags::OPTIONAL) {
                        b"?"
                    } else if flags.contains(Flags::DEFINITE) {
                        b"!"
                    } else {
                        b""
                    }
                }
            };
            let ty = match type_node {
                Some(node) => node.text.clone(),
                None => {
                    let ty = self.c.type_of_index_component(component);
                    self.type_to_node(ty).text
                }
            };
            results.push(cat!(modifier, name, postfix_token, b": ", ty, b";"));
        }
        (!bailed).then_some(results)
    }

    // ───────────────────────────── properties ─────────────────────────────

    /// The property `name` of `ty`, for its declarations. `resolveReverseMappedTypeMembers`: a property of a reverse mapped type has those
    /// of the property of the source it is inferred from.
    fn property_with_declarations(&mut self, ty: TypeId, name: Atom) -> Option<Prop<'s>> {
        let mut of = ty;
        while let TypeData::ReverseMapped { source, .. } = *self.c.data(of) {
            of = source;
        }
        let arena = self.c.arena;
        (self.c.prop_ref(of, name)).map(|found| found.0.clone_in(arena))
    }

    fn place_of_symbol(&self, symbol: Sym) -> Place {
        let files = self.c.files();
        let Some((file, decl)) = files.decls(symbol).first().copied() else {
            return Place::Nowhere;
        };
        let pos = self.c.files().start_of_declaration(file, decl);
        Place::At(self.c.place_in_program_order(file, pos))
    }

    /// The position of the first declaration of `prop`.
    fn place_of_property(&mut self, prop: &Prop) -> Place {
        let at = |c: &Checker<'p, '_>, file: FileId, pos: u32| {
            Place::At(c.place_in_program_order(file, pos))
        };
        let Some(prop) = first_declared(prop) else {
            return Place::Nowhere;
        };
        match &prop.source {
            PropSource::Literal(file, written) => {
                let pos = self
                    .c
                    .first_declaration_pos_of_literal_property(*file, *written);
                at(&*self.c, *file, pos)
            }
            PropSource::Symbol(symbol) => match self.c.files().value_declaration(*symbol) {
                Some((file, Decl::Expando(first) | Decl::ThisProperty(first))) => {
                    at(&*self.c, file, self.c.hir(file)[first].pos)
                }
                _ => self.place_of_symbol(*symbol),
            },
            _ => Place::Nowhere,
        }
    }

    /// `getNamedMembers` sorts with `compareSymbols`: by the position of the first declaration, and
    /// those without one last, by name.
    fn ordered_properties(&mut self, props: &[Prop]) -> Vec<Prop<'s>> {
        let mut keyed: Vec<((u8, (bool, u32, u32), &'p [u8]), &Prop)> =
            Vec::with_capacity(props.len());
        for prop in props {
            let name = self.c.atoms().bytes(prop.name);
            let place = match &prop.source {
                PropSource::Literal(file, written) => {
                    let pos = self
                        .c
                        .first_declaration_pos_of_literal_property(*file, *written);
                    Place::At(self.c.place_in_program_order(*file, pos))
                }
                _ => self.place_of_property(prop),
            };
            keyed.push(match place {
                Place::At(place) => ((0, place, name), prop),
                Place::Nowhere => ((1, (false, 0, 0), name), prop),
            });
        }
        keyed.sort_by(|a, b| a.0.cmp(&b.0));
        let arena = self.c.arena;
        (keyed.into_iter().map(|entry| entry.1.clone_in(arena))).collect()
    }

    /// The syntax of the name in the declaration `written` of an object literal property.
    fn name_syntax_of_literal_property(
        &mut self,
        file: FileId,
        written: PropId,
    ) -> PropertyNameSyntax {
        let hir = self.c.hir(file);
        let written = &hir[written];
        let at = written.pos as usize;
        let first = hir.text.get(at).copied();
        // In an object literal every name in brackets gives the property a `nameType`.
        let in_brackets = first == Some(b'[');
        let is_string = match written.key {
            PropKey::Computed(e) => {
                let key = self.c.type_of_expr(file, e);
                self.c.is_string_like(key)
            }
            _ if in_brackets => matches!(
                hir.text[at + 1..]
                    .iter()
                    .find(|b| !b.is_ascii_whitespace() && **b != b'('),
                Some(b'"' | b'\'' | b'`')
            ),
            _ => matches!(first, Some(b'"' | b'\'')),
        };
        PropertyNameSyntax {
            is_string,
            is_single_quoted: first == Some(b'\''),
            is_computed: in_brackets || matches!(written.key, PropKey::Computed(_)),
        }
    }

    /// `getSymbolOfDeclaration(memberDecl).Declarations` for the member `written` of an object
    /// literal.
    fn declarations_of_literal_member(&mut self, file: FileId, written: PropId) -> Vec<PropId> {
        let declarations = (self.c).declarations_of_member(file, Decl::Property(written));
        let members = declarations.iter().filter_map(|it| match it.1 {
            Decl::Property(member) => Some(member),
            _ => None,
        });
        members.collect()
    }

    /// The syntax of the name in each declaration of `prop`.
    fn property_name_syntaxes(&mut self, prop: &Prop, out: &mut Vec<PropertyNameSyntax>) {
        let plain = PropertyNameSyntax {
            is_string: false,
            is_single_quoted: false,
            is_computed: false,
        };
        for_each_declared(prop, &mut |prop| {
            match &prop.source {
                PropSource::Symbol(symbol) => {
                    let list = self.c.members_of_symbol(*symbol);
                    let assignments = match list.is_empty() {
                        true => self.c.assignments_of_symbol(*symbol),
                        false => smallvec::SmallVec::new(),
                    };
                    if list.is_empty() && assignments.is_empty() {
                        out.push(plain);
                    }
                    for &declaration in assignments.iter() {
                        let hir = self.c.hir(symbol.file);
                        let is_string = match hir[declaration].kind {
                            ExprKind::Assign { target, .. } => match hir[target].kind {
                                ExprKind::Index { index, .. } => {
                                    let key = self.c.type_of_expr(symbol.file, index);
                                    self.c.is_string_like(key)
                                }
                                _ => false,
                            },
                            _ => false,
                        };
                        out.push(PropertyNameSyntax { is_string, ..plain });
                    }
                    for &(file, member) in list.iter() {
                        let hir = self.c.hir(file);
                        let member = &hir[member];
                        let (is_string, is_computed) = match member.key {
                            PropKey::Computed(e) => {
                                let key = self.c.type_of_expr(file, e);
                                (self.c.is_string_like(key), true)
                            }
                            _ => (member.flags.contains(Flags::STRING_NAME), false),
                        };
                        out.push(PropertyNameSyntax {
                            is_string,
                            is_single_quoted: hir.text.get(member.name_pos as usize)
                                == Some(&b'\''),
                            is_computed,
                        });
                    }
                }
                PropSource::Literal(file, written) => {
                    for declaration in self.declarations_of_literal_member(*file, *written) {
                        let name = self.name_syntax_of_literal_property(*file, declaration);
                        out.push(name);
                    }
                }
                _ => {}
            }
            false
        });
    }

    /// `getPropertyNameNodeForSymbol`
    fn property_name(&mut self, prop: &Prop) -> Vec<u8> {
        let bytes = self.c.atoms().bytes(prop.name);
        if self.c.is_private_identifier_symbol(prop.name) {
            return self.c.written_name(prop.name).to_vec();
        }
        // `getPropertyNameNodeForSymbolFromNameType`: the `nameType` is a `unique symbol`.
        if self.c.atoms().is_symbol_name(prop.name) {
            let outer = self.enclosing_declaration;
            if let Some(own) = self.enclosing_declaration_of_property_name(prop) {
                self.enclosing_declaration = Some(own);
            }
            let expression = match self.symbol_of_name_type(prop.name) {
                Ok(symbol) => self.symbol_to_expression(symbol),
                Err(description) => self.text(description),
            };
            self.enclosing_declaration = outer;
            return cat!(b"[", expression, b"]");
        }
        let name = bytes.to_vec();
        let mut written = Vec::new();
        self.property_name_syntaxes(prop, &mut written);
        let is_string_named = !written.is_empty() && written.iter().all(|w| w.is_string);
        let quote = if !written.is_empty() && written.iter().all(|w| w.is_single_quoted) {
            b'\''
        } else {
            b'"'
        };
        let has_name_type = self.has_name_type(prop);
        let is_identifier = is_identifier(&name);
        let is_numeric = self.c.is_numeric_name(prop.name);
        // `getPropertyNameNodeForSymbolFromNameType`
        if has_name_type
            && !is_identifier
            && is_numeric
            && !is_string_named
            && name.starts_with(b"-")
        {
            return cat!(b"[", name, b"]");
        }
        // `classifyPropertyName`
        let is_new_method = prop.flags.contains(PropFlags::METHOD) && name == b"new";
        if !is_new_method
            && (is_identifier || !is_string_named && is_numeric && !name.starts_with(b"-"))
        {
            return name;
        }
        self.string_literal(&name, quote)
    }

    /// `nameType.symbol` of a property that a `unique symbol` names `name`, or else the description
    /// of that.
    fn symbol_of_name_type(&mut self, name: Atom) -> Result<Sym, Atom> {
        match self.c.key_type_of_name(name).map(|ty| self.c.data(ty)) {
            Some(&TypeData::UniqueSymbol { symbol, name }) => {
                (self.c.symbol_of_unique_symbol(symbol, name)).ok_or(name)
            }
            _ => Err(name),
        }
    }

    /// `getNameOfSymbolFromNameType`, using the name alone.
    fn name_from_name_type(&mut self, name: Atom) -> Vec<u8> {
        let bytes = self.c.atoms().bytes(name);
        if self.c.is_private_identifier_symbol(name) {
            return self.c.written_name(name).to_vec();
        }
        if self.c.atoms().is_symbol_name(name) {
            let text = match self.symbol_of_name_type(name) {
                Ok(symbol) => self.name_of_symbol_as_written(symbol, true),
                Err(description) => self.text(description),
            };
            return cat!(b"[", text, b"]");
        }
        let text = bytes.to_vec();
        let is_numeric = self.c.is_numeric_name(name);
        if !is_identifier(&text) && !is_numeric {
            return quoted(&text, b'"', false);
        }
        if is_numeric && text.starts_with(b"-") {
            return cat!(b"[", text, b"]");
        }
        text
    }

    /// `links.nameType != nil`
    fn has_name_type(&mut self, prop: &Prop) -> bool {
        match &prop.source {
            PropSource::Type(_) => false,
            // `checkObjectLiteral` takes it from the member the property is created from, whatever
            // else declares the name.
            PropSource::Literal(file, member) => {
                self.name_syntax_of_literal_property(*file, *member)
                    .is_computed
            }
            // `lateBindMember`
            PropSource::Symbol(symbol) => self.c.files().symbol(*symbol).name == known::computed,
            PropSource::Mapped(..) => true,
            // That of the first.
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts) => match parts.first() {
                Some(first) => self.has_name_type(first),
                None => false,
            },
        }
    }

    /// Whether `getWidenedProperty` or `transformTypeOfMembers` replaces the symbol by
    /// `createSymbolWithType`, which they do if its type changes.
    fn is_created_with_other_type(&mut self, prop: &Prop) -> bool {
        let read_with = PropFlags::WIDEN | PropFlags::REGULAR;
        if !prop.flags.intersects(read_with) {
            return false;
        }
        let mut original = prop.clone_in(self.c.arena);
        original.flags.remove(read_with);
        self.c.type_of_prop(prop, MapperId::IDENTITY)
            != self.c.type_of_prop(&original, MapperId::IDENTITY)
    }

    /// `symbol.CheckFlags&ast.CheckFlagsLate != 0`. `createSymbolWithType`,
    /// `createUnionOrIntersectionProperty` and the symbol `getSpreadType` makes of two drop the
    /// flag. `getSpreadSymbol`, `getAnonymousPartialType` and `resolveMappedTypeMembers` copy it.
    fn is_late_bound(&mut self, prop: &Prop) -> bool {
        if self.is_created_with_other_type(prop) {
            return false;
        }
        match &prop.source {
            PropSource::Type(_) | PropSource::Intersected(..) | PropSource::ReverseMapped(..) => {
                false
            }
            PropSource::Literal(..) | PropSource::Symbol(_) => self.has_name_type(prop),
            PropSource::Mapped(..) => match prop.declared_by_modifiers_property() {
                [modifiers_prop] => self.is_late_bound(modifiers_prop),
                _ => false,
            },
            PropSource::Copy(ty, parts, has_value_declaration) => match &parts[..] {
                // With a `ValueDeclaration` it is the symbol itself if it has the type of that.
                [source] => {
                    (!*has_value_declaration
                        || prop.flags.contains(PropFlags::WRITTEN)
                        || self.c.type_of_prop(source, MapperId::IDENTITY) == *ty)
                        && self.is_late_bound(source)
                }
                _ => false,
            },
        }
    }

    /// `getNameOfSymbolAsWritten`, from where it has found `name` of `file`, the name in the first
    /// declaration of `prop` that has one.
    fn name_of_declared_property(&mut self, prop: &Prop, file: FileId, name: hir::Node) -> Vec<u8> {
        if self.c.hir(file).kind(name) == Kind::ComputedPropertyName
            && !self.c.atoms().is_symbol_name(prop.name)
            && self.has_name_type(prop)
            && !self.is_late_bound(prop)
        {
            return self.name_from_name_type(prop.name);
        }
        self.declaration_name_to_string(file, name)
    }

    /// `getNameOfSymbolAsWritten` for a property.
    fn name_of_property_as_written(&mut self, whole: &Prop) -> Vec<u8> {
        self.c.get_symbol_id_of_property(whole);
        let prop = first_declared(whole).unwrap_or(whole);
        match &prop.source {
            PropSource::Literal(file, property) => {
                // A computed name ends where the parser stopped, even if the `]` is missing, and
                // the name of a JSX attribute is more than one token (`data-\u0061`): `end_of_node`
                // handles both.
                let first = (self.c).first_declaration_of_literal_member(*file, *property);
                let name = self.c.hir(*file).node(first).with(Part::Name);
                return self.name_of_declared_property(whole, *file, name);
            }
            PropSource::Symbol(symbol) => {
                return match self.c.files().value_declaration(*symbol) {
                    Some((file, Decl::Member(member)))
                        if (self.c)
                            .type_parameter_merged_with_member(file, member, prop.name)
                            .is_some() =>
                    {
                        self.c.atoms().bytes(prop.name).to_vec()
                    }
                    Some((file, Decl::Member(member))) => {
                        // `2n`, and `#x` outside a class, are not a `PropKey` but are still printed.
                        let name = self.c.hir(file).node(member).with(Part::Name);
                        self.name_of_declared_property(whole, file, name)
                    }
                    Some((file, Decl::ParameterProperty(parameter))) => {
                        let hir = self.c.hir(file);
                        self.declaration_name_to_string(file, hir.name(hir.node(parameter)))
                    }
                    Some((file, Decl::Expando(first) | Decl::ThisProperty(first))) => {
                        match self.c.name_of_assignment_declaration(file, first) {
                            Some(text) => text,
                            None => self.name_from_name_type(prop.name),
                        }
                    }
                    _ => self.symbol_to_text(*symbol),
                };
            }
            _ => {}
        }
        self.name_from_name_type(prop.name)
    }

    /// The links of the property `name` of the reverse mapped type `owner`.
    fn reverse_mapped_property(&mut self, owner: TypeId, name: Atom) -> ReverseMappedProperty {
        let (source, mapped) = match *self.c.data(owner) {
            TypeData::ReverseMapped { source, mapped, .. } => (source, mapped),
            _ => (owner, owner),
        };
        ReverseMappedProperty {
            owner,
            name,
            property_type: self.c.type_of_property(source, name).unwrap_or(TypeId::ANY),
            mapped: self
                .c
                .mapped_origin(mapped)
                .map(|origin| (origin.0, origin.1)),
        }
    }

    /// `shouldUsePlaceholderForProperty`
    fn should_use_placeholder_for_property(&self, property: &ReverseMappedProperty) -> bool {
        let stack = &self.reverse_mapped_stack;
        if stack
            .iter()
            .any(|on| on.owner == property.owner && on.name == property.name)
        {
            return true;
        }
        if let Some(last) = stack.last()
            && !self.c.is_anonymous_object_type(last.property_type)
        {
            return true;
        }
        stack.len() >= 3
            && property.mapped.is_some()
            && stack
                .iter()
                .rev()
                .take(4)
                .any(|on| on.mapped == property.mapped)
    }

    /// Whether the accessor `prop` is declared in a class, and whether it is an `accessor` field.
    fn accessor_declaration(&self, prop: &Prop) -> (bool, bool) {
        match self.c.value_declaration_of_prop(prop) {
            Some((file, Decl::Member(member))) if matches!(prop.source, PropSource::Symbol(_)) => (
                matches!(
                    self.c.bound(file).member_owner[member.idx()],
                    MemberOwner::Class(_)
                ),
                self.c.hir(file)[member].kind == MemberKind::Property,
            ),
            _ => (false, false),
        }
    }

    /// `ast.GetDeclarationOfKind(symbol, kind)` for a getter or a setter of `prop`, with its
    /// function.
    fn accessor_of_kind(
        &mut self,
        prop: &Prop,
        kind: MemberKind,
    ) -> Option<(FileId, hir::Node, FnId)> {
        let mut found = None;
        for_each_declared(prop, &mut |declared| {
            found = match declared.source {
                PropSource::Symbol(symbol) => (self.c.members_of_symbol(symbol).iter())
                    .find(|&&(file, member)| self.c.hir(file)[member].kind == kind)
                    .map(|&(file, member)| {
                        let hir = self.c.hir(file);
                        (file, hir.node(member), hir[member].func)
                    }),
                PropSource::Literal(file, p) => {
                    let hir = self.c.hir(file);
                    let kind = match kind {
                        MemberKind::Getter => PropKind::Getter,
                        _ => PropKind::Setter,
                    };
                    let declarations = self.declarations_of_literal_member(file, p);
                    let is_of_kind = |&declaration: &PropId| hir[declaration].kind == kind;
                    let mut accessors = declarations.into_iter().filter(is_of_kind);
                    accessors.find_map(|accessor| match hir[hir[accessor].value].kind {
                        ExprKind::Fn(func) => Some((file, hir.node(accessor), func)),
                        _ => None,
                    })
                }
                _ => None,
            };
            found.is_some()
        });
        found.filter(|accessor| accessor.2.is_some())
    }

    /// The start of `addPropertyToElementList` for a property named by a `unique symbol`.
    fn track_late_bound_name(&mut self, prop: &Prop) {
        let Some(prop) = first_declared(prop) else {
            let mut name = Vec::new();
            self.c.write_prop(&mut name, prop);
            return self.report(Report::NonSerializableProperty(name));
        };
        let (file, key) = match &prop.source {
            PropSource::Symbol(symbol) => match self.c.files().value_declaration(*symbol) {
                Some((file, Decl::Member(m))) => (file, self.c.hir(file)[m].key),
                // `ast.IsBinaryExpression(decl)`
                Some((file, Decl::Expando(e) | Decl::ThisProperty(e))) => {
                    let hir = self.c.hir(file);
                    if let ExprKind::Assign { target, .. } = hir[e].kind
                        && let ExprKind::Index { index, .. } = hir[target].kind
                        && !is_parenthesized(hir, index)
                        && is_property_access_entity_name_expression(hir, index)
                    {
                        self.track_computed_name(file, index);
                    }
                    return;
                }
                _ => return,
            },
            PropSource::Literal(file, p) => (*file, self.c.hir(*file)[*p].key),
            _ => return,
        };
        // `hasLateBindableName`
        if let PropKey::Computed(e) = key
            && is_entity_name_expression(self.c.hir(file), e)
        {
            self.track_computed_name(file, e);
        }
    }

    /// `trackComputedName(accessExpression, b.ctx.enclosingDeclaration)`
    fn track_computed_name(&mut self, file: FileId, access_expression: ExprId) {
        let Some(at) = self.enclosing_declaration else {
            return;
        };
        let files = self.c.files();
        let hir = self.c.hir(file);
        let first_identifier = first_identifier(hir, access_expression);
        let ExprKind::Ident(name) = hir[first_identifier].kind else {
            return;
        };
        let meaning = SymFlags::VALUE | SymFlags::EXPORT_VALUE;
        // A name that does not resolve where the type is printed is tracked as the symbol it
        // resolves to in its source position, which should be inaccessible.
        let symbol = files
            .resolve_name(at.file, at.scope, name, meaning)
            .or_else(|| {
                let scope = self.c.enclosing_scope_of_expr(file, first_identifier);
                files.resolve_name(file, scope, name, meaning)
            });
        if let Some(symbol) = symbol {
            self.track_symbol(symbol, SymFlags::VALUE);
        }
    }

    /// `parameterToParameterDeclarationName`, only what it tracks: nothing for an identifier.
    fn track_parameter_declaration_name(&mut self, file: FileId, parameter: ParamId) {
        let hir = self.c.hir(file);
        let name = hir[parameter].pat;
        if self.tracker.is_some()
            && name.is_some()
            && matches!(hir[name].kind, PatKind::Object(_) | PatKind::Array(_))
        {
            self.track_computed_names_in(file, hir.node(name));
        }
    }

    /// `cloneBindingName`, only what it tracks: the late-bindable names in `node` of `file`. Its
    /// visitor also enters the initializers that it then removes.
    fn track_computed_names_in(&mut self, file: FileId, node: hir::Node) {
        let hir = self.c.hir(file);
        // `isLateBindableName`
        if hir.kind(node) == Kind::ComputedPropertyName
            && let NodeData::Expr(name) = hir.data(hir.expression(node))
            && is_entity_name_expression(hir, name)
            && self.c.member_name(file, PropKey::Computed(name)).is_some()
        {
            self.track_computed_name(file, name);
        }
        let mut children = Vec::new();
        hir.for_each_child(node, &mut |child| {
            children.push(child);
            false
        });
        for child in children {
            self.track_computed_names_in(file, child);
        }
    }

    /// `len(ast.SymbolName(propertySymbol))`
    fn length_of_symbol_name(&mut self, name: Atom) -> usize {
        let length = self.c.length_of_late_bound_name(name);
        length.unwrap_or_else(|| self.c.written_name(name).len())
    }

    /// `addPropertyToElementList`
    fn add_property_to_element_list(
        &mut self,
        owner: TypeId,
        prop: &Prop,
        mapper: MapperId,
        elements: &mut Vec<Vec<u8>>,
    ) {
        let reverse_mapped = if matches!(self.c.data(owner), TypeData::ReverseMapped { .. }) {
            Some(self.reverse_mapped_property(owner, prop.name))
        } else {
            None
        };
        let uses_placeholder = reverse_mapped
            .as_ref()
            .is_some_and(|property| self.should_use_placeholder_for_property(property));
        let is_optional = prop.flags.contains(PropFlags::OPTIONAL);
        let is_readonly = self.c.is_readonly_symbol(prop);
        // `getNonMissingTypeOfSymbol`
        let property_type = if uses_placeholder {
            TypeId::ANY
        } else {
            let ty = self.c.type_of_prop(prop, mapper);
            self.c.remove_missing_type(ty, is_optional)
        };
        // `isLateBoundName`
        if self.c.atoms().is_symbol_name(prop.name) {
            self.track_late_bound_name(prop);
        }
        let declared = if reverse_mapped.is_some() {
            self.property_with_declarations(owner, prop.name)
        } else {
            None
        };
        let name = match declared {
            Some(mut declared) => {
                declared.flags.remove(PropFlags::METHOD);
                self.property_name(&declared)
            }
            None => self.property_name(prop),
        };
        self.approximate_length += self.length_of_symbol_name(prop.name) + 1;
        if prop.flags.contains(PropFlags::ACCESSOR) {
            let write_type = self.c.write_type_of_prop(prop, mapper);
            let (in_class, is_field) = self.accessor_declaration(prop);
            let is_error = self.c.is_error_type(property_type) || self.c.is_error_type(write_type);
            if !is_error && (property_type != write_type || in_class && !is_field) {
                let symbol_mapper = self.c.compose(prop.mapper, mapper);
                for (accessor, kind) in [
                    (MemberKind::Getter, SignatureKind::GetAccessor),
                    (MemberKind::Setter, SignatureKind::SetAccessor),
                ] {
                    let Some((file, declaration, func)) = self.accessor_of_kind(prop, accessor)
                    else {
                        continue;
                    };
                    let signature = self.c.sig_of_fn(file, func);
                    let signature = self.c.instantiate_sig(signature, symbol_mapper);
                    let text = self.signature_to_text(signature, kind, &name, false);
                    elements.push(cat!(self.comments_before(file, declaration), text, b";"));
                }
                return;
            }
            // The two signatures `newSignature` creates for an `accessor` field have no
            // declaration.
            if !is_error && in_class {
                self.approximate_length += 3;
                let getter = self.type_to_node_without_inference_fallback(property_type);
                let comments = self.comments_of_value_declaration(prop);
                elements.push(cat!(comments, b"get ", name, b"(): ", getter.text, b";"));
                self.approximate_length += 3;
                let setter = self.type_to_node(write_type);
                self.approximate_length += b"arg".len() + 3 + b"void".len();
                elements.push(cat!(b"set ", name, b"(arg: ", setter.text, b");"));
                return;
            }
        }
        let is_function = prop.flags.contains(PropFlags::METHOD)
            || matches!(prop.source, PropSource::Symbol(symbol) if self.c.files().flags(symbol).contains(SymFlags::FUNCTION));
        if is_function && !is_readonly {
            let has_properties = self.c.is_object_type(property_type)
                && self
                    .c
                    .members(property_type)
                    .is_some_and(|members| !members.shape().props.is_empty());
            if !has_properties {
                let callable = self
                    .c
                    .filter(property_type, |_, member| !member.is_undefined());
                let signatures = self.c.signatures(callable, false);
                for &signature in &signatures {
                    let text = self.signature_to_text(
                        signature,
                        SignatureKind::Method,
                        &name,
                        is_optional,
                    );
                    // `core.Coalesce(signature.declaration, propertySymbol.ValueDeclaration)`
                    let origin = self.c.types().sig_origin(signature);
                    let comments = match self.c.sig_decl(origin) {
                        Some((file, func, _)) => {
                            let declaration = match self.c.bound(file).fns[func.idx()].owner {
                                FnOwner::Member(m) => self.c.hir(file).node(m),
                                FnOwner::Expr(e) => match self.c.bound(file).expr_parent[e.idx()] {
                                    Parent::Prop(p) => self.c.hir(file).node(p),
                                    _ => hir::Node::NONE,
                                },
                                _ => hir::Node::NONE,
                            };
                            self.comments_before(file, declaration)
                        }
                        None => self.comments_of_value_declaration(prop),
                    };
                    elements.push(cat!(comments, text, b";"));
                }
                if !signatures.is_empty() || !is_optional {
                    return;
                }
            }
        }
        let node = if uses_placeholder {
            self.elided_information_placeholder()
        } else {
            if let Some(property) = reverse_mapped {
                self.reverse_mapped_stack.push(property);
            }
            let node = self.serialize_type_of_property(owner, prop, property_type);
            if reverse_mapped.is_some() {
                self.reverse_mapped_stack.pop();
            }
            node
        };
        let modifier: &[u8] = if is_readonly {
            self.approximate_length += 9;
            b"readonly "
        } else {
            b""
        };
        let question: &[u8] = if is_optional { b"?" } else { b"" };
        let comments = self.comments_of_value_declaration(prop);
        elements.push(cat!(
            comments, modifier, name, question, b": ", node.text, b";"
        ));
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// `getLiteralText` for a string literal that has no position: `text`, in the quotes of the
    /// literal at `start` of `file`, under `EFNoAsciiEscaping`.
    fn cloned_string_literal_text(&self, file: FileId, text: Atom, start: u32) -> Vec<u8> {
        let quote = match self.c.hir(file).text.get(start as usize) {
            Some(&quote @ (b'\'' | b'`')) => quote,
            _ => b'"',
        };
        quoted(self.c.atoms().bytes(text), quote, false)
    }

    /// What the printer emits for a deep clone of the expression `e` of `file`. No node of a clone
    /// has a position, so `getTextOfNode` and `getLiteralText` emit `node.Text()`. `None`: `e` is
    /// neither a literal nor an entity name.
    fn cloned_expression_text(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let text = match hir[e].kind {
            ExprKind::Ident(name) => self.text(name),
            ExprKind::Dot { .. } if is_property_access_entity_name_expression(hir, e) => {
                self.entity_name_text(file, e)?
            }
            ExprKind::Number(n) => crate::atom::number_to_string(hir.numbers[n as usize]),
            ExprKind::String(value) => self.cloned_string_literal_text(file, value, hir[e].pos),
            ExprKind::Unary { op, operand }
                if matches!(op, UnOp::Plus | UnOp::Minus)
                    && matches!(hir[operand].kind, ExprKind::Number(_)) =>
            {
                let sign: &[u8] = if op == UnOp::Plus { b"+" } else { b"-" };
                cat!(sign, self.cloned_expression_text(file, operand)?)
            }
            _ => return None,
        };
        let parentheses = parentheses_around(hir, e).len();
        Some(cat!(
            b"(".repeat(parentheses),
            text,
            b")".repeat(parentheses)
        ))
    }

    /// The same for the property name of the binding element `p`. `None`: also for an identifier.
    fn cloned_property_name_text(&self, file: FileId, p: PatPropId) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let name = match hir[p].key {
            PropKey::Name(name) => name,
            PropKey::Computed(e) => {
                return Some(cat!(b"[", self.cloned_expression_text(file, e)?, b"]"));
            }
            PropKey::Private(_) | PropKey::None => return None,
        };
        match hir[p].name_kind {
            NameKind::StringLiteral => {
                Some(self.cloned_string_literal_text(file, name, hir[p].key_pos))
            }
            NameKind::NumericLiteral => Some(self.text(name)),
            NameKind::ComputedString => {
                let literal = hir.start(hir.node(p).with(Part::NameLiteral));
                let literal = self.cloned_string_literal_text(file, name, literal);
                Some(cat!(b"[", literal, b"]"))
            }
            NameKind::ComputedNumber => Some(cat!(b"[", self.text(name), b"]")),
            NameKind::Identifier | NameKind::Jsx => None,
        }
    }

    /// `cloneBindingName`: a name or a binding pattern, on one line and without initializers. For
    /// the declaration transformer, `filterBindingPatternInitializers`, which keeps the nodes.
    fn binding_name_text(&self, file: FileId, pat: PatId) -> Vec<u8> {
        if pat.is_none() {
            return Vec::new();
        }
        let hir = self.c.hir(file);
        match hir[pat].kind {
            PatKind::Missing => Vec::new(),
            PatKind::Ident(name) => self.text(name),
            PatKind::Object(props) => {
                let mut parts = Vec::with_capacity(props.len());
                for p in props.iter() {
                    let prop = &hir[p];
                    let value = self.binding_name_text(file, prop.value);
                    parts.push(if prop.is_rest {
                        cat!(b"...", value)
                    } else if prop.value.is_some() && hir[prop.value].pos == prop.pos {
                        value
                    } else {
                        let cloned = match self.is_transformer {
                            true => None,
                            false => self.cloned_property_name_text(file, p),
                        };
                        let name = cloned.unwrap_or_else(|| {
                            self.property_key_text(file, hir.property_name(hir.node(p)))
                        });
                        cat!(name, b": ", value)
                    });
                }
                let ends: Vec<u32> = (props.iter())
                    .map(|p| self.c.end_of_pat_prop(file, p))
                    .collect();
                if parts.is_empty() {
                    b"{}".to_vec()
                } else {
                    let open = hir[pat].pos + 1;
                    let list =
                        self.list_text(file, parts, &ends, Some(open), b",", true, usize::MAX);
                    cat!(b"{ ", list, b" }")
                }
            }
            PatKind::Array(elems) => {
                let mut parts = Vec::with_capacity(elems.len());
                for e in elems.iter() {
                    let name = self.binding_name_text(file, hir[e].pat);
                    parts.push(if hir[e].is_rest {
                        cat!(b"...", name)
                    } else {
                        name
                    });
                }
                let ends: Vec<u32> = (elems.iter())
                    .map(|e| self.c.end_of_pat_elem(file, e))
                    .collect();
                let open = hir[pat].pos + 1;
                let list = self.list_text(file, parts, &ends, Some(open), b",", true, usize::MAX);
                cat!(b"[", list, b"]")
            }
        }
    }

    /// `emitListItems` for a single-line list whose elements are nodes of `file`: `parts` is the
    /// emitted text of each, `ends` their `End()`. `first_pos`: `Pos()` of the first element,
    /// unless that equals `Pos()` of the list's parent, which emits those comments. Each other
    /// element starts at the end of the preceding delimiter. `delimiter`, `parent_end`: see
    /// `Writer::emit_list_items`. The comments between the elements are emitted when a declaration
    /// file is emitted for `file`.
    pub(super) fn list_text(
        &self,
        file: FileId,
        parts: Vec<Vec<u8>>,
        ends: &[u32],
        first_pos: Option<u32>,
        delimiter: &[u8],
        allows_trailing_comma: bool,
        parent_end: usize,
    ) -> Vec<u8> {
        use super::errors_declaration_emit::{Element, ListFormat, Writer};
        let text = &self.c.hir(file).text[..];
        let token = *delimiter.last().unwrap_or(&b',');
        // End of the delimiter that follows the element ending at `end`.
        let after_delimiter = |end: u32| {
            let at = self.c.skip_trivia_from(file, end);
            (text.get(at as usize) == Some(&token)).then_some(at + 1)
        };
        let has_trailing_comma = allows_trailing_comma
            && ends
                .last()
                .is_some_and(|&end| after_delimiter(end).is_some());
        let Some(indent) = self.indent.filter(|_| self.should_emit_comments(file)) else {
            let separator = cat!(delimiter, b" ");
            let comma: &[u8] = if has_trailing_comma { b"," } else { b"" };
            return cat!(parts.join(&separator[..]), comma);
        };
        let mut pos = first_pos;
        let mut elements = Vec::with_capacity(parts.len());
        for (part, &end) in parts.into_iter().zip(ends) {
            elements.push(Element {
                range: pos.map(|pos| (pos as usize, end as usize)),
                text: part,
            });
            pos = after_delimiter(end);
        }
        let mut writer = Writer::new(text, indent);
        let format = ListFormat {
            has_trailing_comma,
            ..ListFormat::SINGLE_LINE
        };
        writer.emit_list_items(&elements, delimiter, format, parent_end);
        writer.into_text()
    }

    /// `signature.parameters`, each with the information `symbolToParameterDeclaration` computes
    /// for it.
    fn signature_parameters(&mut self, signature: SigId) -> Vec<Parameter> {
        let (file, func, mapper) = match self.c.types().sig(signature) {
            SigData::WithReturn { sig: inner, .. } => {
                let inner = *inner;
                return self.signature_parameters(inner);
            }
            SigData::Synth { params, .. } => {
                let mut list = Vec::with_capacity(params.len());
                for (i, parameter) in params.iter().enumerate() {
                    let name = if parameter.name.is_some() {
                        self.text(parameter.name)
                    } else {
                        cat!(b"arg", itoa(&mut ItoaBuf::new(), i))
                    };
                    list.push(Parameter {
                        name_length: name.len(),
                        name,
                        ty: parameter.ty,
                        optional: parameter.optional,
                        rest: parameter.rest,
                        declaration: None,
                    });
                }
                return list;
            }
            SigData::DefaultConstruct { .. } => {
                return match self.c.default_construct_base_sig(signature) {
                    Some(base) if base != signature => self.signature_parameters(base),
                    _ => Vec::new(),
                };
            }
            SigData::Decl { file, func, mapper }
            | SigData::Construct {
                file, func, mapper, ..
            } => (*file, *func, *mapper),
        };
        let hir = self.c.hir(file);
        let parameters = hir[func].params;
        let strict = self.c.p.files.options.strict_null_checks;
        let mut list = Vec::with_capacity(parameters.len());
        for (i, p) in parameters.iter().enumerate() {
            let parameter = &hir[p];
            let declared = self.c.type_of_param(file, p);
            let mut ty = self.c.instantiate(declared, mapper);
            let optional = self.c.is_optional_parameter(file, p);
            // `requiresAddingImplicitUndefined`: a parameter with an initializer that cannot be
            // omitted accepts `undefined`.
            if strict
                && !optional
                && parameter.default.is_some()
                && !parameter.flags.contains(Flags::PARAMETER_PROPERTY)
            {
                let written = self.c.type_from_node(file, parameter.ty);
                // `declaredParameterTypeContainsUndefined`
                let includes_undefined = parameter.ty.is_some()
                    && (self.c.is_error_type(written) || self.c.contains_undefined(written));
                if !includes_undefined {
                    ty = self.c.optional(ty);
                }
            }
            let name = self.binding_name_text(file, parameter.pat);
            let name_length = match hir[parameter.pat].kind {
                PatKind::Ident(_) => name.len(),
                // A pattern is bound as `__0`, by its index among `node.Parent.Parameters()`.
                _ => 2 + digit_count(i + usize::from(hir[func].this_param.is_some())),
            };
            list.push(Parameter {
                name,
                name_length,
                ty,
                optional,
                rest: parameter.flags.contains(Flags::REST),
                declaration: Some((file, p)),
            });
        }
        list
    }

    /// `getTupleElementLabel` for element `index` of the tuple type of the rest parameter `rest`.
    fn tuple_element_label(&self, rest: &Parameter, index: usize, flags: ElemFlags) -> Vec<u8> {
        if flags.label().is_some() {
            return self.text(flags.label());
        }
        let Some((file, parameter)) = rest.declaration else {
            return cat!(rest.name, b"_", itoa(&mut ItoaBuf::new(), index));
        };
        let name = self.c.hir(file)[parameter].pat;
        let label =
            (self.c).tuple_element_label_from_binding_element(file, name, true, index, flags);
        self.text(label)
    }

    /// `getExpandedParameters`: a rest parameter of tuple type is expanded into one parameter per
    /// element.
    fn expanded_parameters(&mut self, parameters: &[Parameter]) -> Vec<Parameter> {
        let Some((rest, others)) = parameters.split_last().filter(|split| split.0.rest) else {
            return parameters.to_vec();
        };
        let TypeData::Tuple { flags, .. } = self.c.data(rest.ty) else {
            return parameters.to_vec();
        };
        let elems = self.c.type_arguments(rest.ty);
        let mut names: Vec<Vec<u8>> = (0..elems.len())
            .map(|i| self.tuple_element_label(rest, i, flags[i]))
            .collect();
        // `getUniqAssociatedNamesFromTupleType`
        let mut unique: Vec<Vec<u8>> = Vec::with_capacity(names.len());
        let mut duplicates = Vec::new();
        for (i, name) in names.iter().enumerate() {
            if unique.contains(name) {
                duplicates.push(i);
            } else {
                unique.push(name.clone());
            }
        }
        for i in duplicates {
            let mut counter = 1;
            let name = loop {
                let name = cat!(names[i], b"_", itoa(&mut ItoaBuf::new(), counter));
                if !unique.contains(&name) {
                    break name;
                }
                counter += 1;
            };
            unique.push(name.clone());
            names[i] = name;
        }
        let mut expanded = others.to_vec();
        for (i, name) in names.into_iter().enumerate() {
            let is_variable = flags[i].intersects(ElemFlags::REST | ElemFlags::VARIADIC);
            expanded.push(Parameter {
                name_length: name.len(),
                name,
                ty: if flags[i].contains(ElemFlags::REST) {
                    self.c.array_of(elems[i])
                } else {
                    elems[i]
                },
                optional: !is_variable && flags[i].contains(ElemFlags::OPTIONAL),
                rest: is_variable,
                declaration: None,
            });
        }
        // A list with a variadic element that is not last cannot be printed.
        if expanded
            .split_last()
            .is_some_and(|(_, before)| before.iter().any(|parameter| parameter.rest))
        {
            return parameters.to_vec();
        }
        expanded
    }

    /// `symbolToParameterDeclaration`
    fn parameter_text(&mut self, parameter: &Parameter) -> Vec<u8> {
        let node = self.serialize_type_of_parameter(parameter);
        if let Some((file, declaration)) = parameter.declaration {
            self.track_parameter_declaration_name(file, declaration);
        }
        self.approximate_length += parameter.name_length + 3;
        let text = node.text;
        cat! {
            if parameter.rest { &b"..."[..] } else { b"" }, parameter.name,
            if parameter.optional { &b"?"[..] } else { b"" }, b": ", text
        }
    }

    /// `serializeReturnTypeForSignature`
    fn return_type_node(&mut self, signature: SigId, try_reuse: bool) -> Node {
        let declaration = self.c.sig_decl(signature).map(|of| (of.0, of.1));
        if let Some((file, function)) = declaration {
            self.c.get_symbol_id_of_function(file, function);
        }
        let enclosing = self.enclosing_symbol_types.iter().rev();
        let enclosing = enclosing
            .map(|entry| (Some(entry.0), entry.1))
            .find(|entry| entry.0 == declaration);
        let returned = match (enclosing, declaration) {
            (Some((_, returned)), _) => returned,
            (None, Some(_)) => {
                let returned = self.c.sig_return(signature);
                self.c.instantiate(returned, self.mapper)
            }
            (None, None) => self.c.sig_return(signature),
        };
        if try_reuse && let Some(declaration) = declaration {
            // `addSymbolTypeToContext`
            self.enclosing_symbol_types.push((declaration, returned));
            let reused = self.try_reuse_return_type_of_signature(signature, returned);
            self.enclosing_symbol_types.pop();
            if let Some(reused) = reused {
                return reused;
            }
        }
        // `serializeInferredReturnTypeForSignature`
        let Some(predicate) = self.c.sig_predicate(signature) else {
            return self.type_to_node_without_inference_fallback(returned);
        };
        let mut text = Vec::new();
        if predicate.asserts {
            text.extend_from_slice(b"asserts ");
        }
        match predicate.param {
            Some(_) => text.extend_from_slice(self.c.atoms().bytes(predicate.name)),
            None => text.extend_from_slice(b"this"),
        }
        if let Some(ty) = predicate.ty {
            let ty = self.c.instantiate(ty, self.mapper);
            text.extend_from_slice(b" is ");
            text.extend_from_slice(&self.type_to_node_without_inference_fallback(ty).text);
        }
        Node::simple(text)
    }

    /// `NodeBuilder.SerializeReturnTypeForSignature`, in this context.
    fn serialize_return_type_for_signature(&mut self, signature: SigId) -> Node {
        let (_, outer_scope) = self.enter_signature_scope(signature);
        let returned = self.return_type_node(signature, true);
        self.leave_scope(&outer_scope);
        returned
    }

    /// `signatureToSignatureDeclarationHelper`, as printed text, without the `;` of a member.
    /// `name`, `is_optional`: those of a method.
    fn signature_to_text(
        &mut self,
        signature: SigId,
        kind: SignatureKind,
        name: &[u8],
        is_optional: bool,
    ) -> Vec<u8> {
        let (head, returned) = self.signature_to_parts(signature, kind, name, is_optional);
        match kind {
            SignatureKind::SetAccessor => head,
            _ => cat!(head, returned.text),
        }
    }

    /// The same: all that precedes the return type, and the return type.
    fn signature_to_parts(
        &mut self,
        signature: SigId,
        kind: SignatureKind,
        name: &[u8],
        is_optional: bool,
    ) -> (Vec<u8>, Node) {
        let (expanded, outer_scope) = self.enter_signature_scope(signature);
        self.approximate_length += 3;
        let mut type_parameters = Vec::new();
        let own_type_parameters = self.c.sig_type_params(signature).into_vec();
        let mut clones = self.type_parameters_from_context(signature);
        if !clones.is_empty() && !self.has_inference_context(signature) {
            clones.clear();
        }
        for parameter in own_type_parameters {
            type_parameters.push(self.type_parameter_declaration(parameter, &clones));
        }
        let mut parameters = Vec::with_capacity(expanded.len() + 1);
        for parameter in &expanded {
            parameters.push(self.parameter_text(parameter));
        }
        if let Some((this, declared_by)) = self.c.sig_this_parameter(signature) {
            let node = self.serialize_type_of_this_parameter(declared_by, this);
            self.approximate_length += b"this".len() + 3;
            parameters.insert(0, cat!(b"this: ", node.text));
        }
        let returned = self.return_type_node(signature, true);
        self.leave_scope(&outer_scope);
        let type_parameters = if type_parameters.is_empty() {
            Vec::new()
        } else {
            cat!(b"<", type_parameters.join(&b", "[..]), b">")
        };
        let parameters = parameters.join(&b", "[..]);
        let head = match kind {
            SignatureKind::Call => cat!(type_parameters, b"(", parameters, b"): "),
            SignatureKind::Construct => cat!(b"new ", type_parameters, b"(", parameters, b"): "),
            SignatureKind::Method => {
                let question: &[u8] = if is_optional { b"?" } else { b"" };
                cat! { name, question, type_parameters, b"(", parameters, b"): " }
            }
            SignatureKind::GetAccessor => cat!(b"get ", name, b"(", parameters, b"): "),
            SignatureKind::SetAccessor => cat!(b"set ", name, b"(", parameters, b")"),
            SignatureKind::FunctionType => cat!(type_parameters, b"(", parameters, b") => "),
            SignatureKind::ConstructorType => {
                let modifier: &[u8] = if self.c.is_abstract_signature(signature) {
                    b"abstract "
                } else {
                    b""
                };
                cat! { modifier, b"new ", type_parameters, b"(", parameters, b") => " }
            }
        };
        (head, returned)
    }

    /// `enterSignatureScope`: returns the `getExpandedParameters` of `signature`, and the state
    /// needed to leave the scope.
    fn enter_signature_scope(&mut self, signature: SigId) -> (Vec<Parameter>, OuterScope) {
        let saved_mapper = self.mapper;
        if let Some((_, _, mapper)) = self.c.sig_decl(signature)
            && self
                .c
                .types()
                .mapping(mapper)
                .iter()
                .any(|pair| pair.0 != pair.1)
        {
            self.mapper = mapper;
        }
        let declared = self.signature_parameters(signature);
        let expanded = self.expanded_parameters(&declared);
        let own_type_parameters = self.c.sig_type_params(signature).into_vec();
        let is_instantiated = self.c.sig_decl(signature).is_some_and(|declared| {
            let mapping = self.c.types().mapping(declared.2);
            mapping.iter().any(|pair| pair.0 != pair.1)
        });
        let declarations_of = |parameters: &[Parameter]| -> Vec<Option<(FileId, ParamId)>> {
            parameters.iter().map(|p| p.declaration).collect()
        };
        let mut outer_scope = self.enter_new_scope(
            &declarations_of(&expanded),
            &own_type_parameters,
            Some(&declarations_of(&declared)),
            is_instantiated,
        );
        outer_scope.mapper = saved_mapper;
        (expanded, outer_scope)
    }

    /// `assignContextualParameterTypes`: `sig.typeParameters = context.typeParameters`
    fn type_parameters_from_context(&mut self, signature: SigId) -> Vec<TypeId> {
        match *self.c.types().sig(signature) {
            SigData::WithReturn { sig: inner, .. } => self.type_parameters_from_context(inner),
            _ => self.c.adopted_type_params(signature),
        }
    }

    /// `getInferenceContext(node) != nil` at the time the parameters of the function expression of
    /// `signature` were contextually typed: the function is an argument of a call whose type
    /// arguments are inferred, or is nested in a literal or a conditional expression that is such
    /// an argument. The contextual signature is instantiated in that case, and
    /// `instantiateSignature` clones its type parameters. Here the function has the declared ones.
    fn has_inference_context(&mut self, signature: SigId) -> bool {
        let (file, func) = match *self.c.types().sig(signature) {
            SigData::WithReturn { sig: inner, .. } => return self.has_inference_context(inner),
            SigData::Decl { file, func, .. } => (file, func),
            _ => return false,
        };
        let Some(mut at) = self.c.takes_context(file, func) else {
            return false;
        };
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => bound.prop_owner[p.idx()],
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee != at => {
                        let resolved = self.c.cached_resolved_signature(file, parent);
                        let declared = resolved
                            .and_then(|resolved| resolved.sig)
                            .and_then(|sig| self.c.sig_decl(sig));
                        return hir[call].type_args.is_empty()
                            && declared.is_some_and(|(of, declared, _)| {
                                !self.c.hir(of)[declared].type_params.is_empty()
                            });
                    }
                    ExprKind::Array(_) | ExprKind::Cond { .. } => parent,
                    _ => return false,
                },
                _ => return false,
            };
        }
    }

    /// A function type or a constructor type.
    fn signature_to_node(&mut self, signature: SigId, kind: SignatureKind) -> Node {
        let (head, returned) = self.signature_to_parts(signature, kind, b"", false);
        Node::function(&head, returned)
    }

    // ───────────────────────────── mapped and conditional types ─────────────────────────────

    /// `createMappedTypeNodeFromType`
    fn mapped_type_to_node(&mut self, ty: TypeId) -> Node {
        let Some((file, node, mapper)) = self.c.mapped_origin(ty) else {
            return self.elided_information_placeholder();
        };
        let mapped = self.c.mapped_decl(file, node);
        let is_constrained = self.c.hir(file)[mapped.param].constraint.is_some();
        let over_keyof = if is_constrained {
            self.c.mapped_modifiers_source(file, node)
        } else {
            None
        };
        let generates_names = self.flags & GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS != 0;
        // `getModifiersTypeFromMappedType`
        let modifiers = over_keyof.map(|(declared, _)| self.c.instantiate(declared, mapper));
        // `isHomomorphicMappedTypeWithNonHomomorphicInstantiation`
        let is_homomorphic_with_non_homomorphic_instantiation = generates_names
            && matches!(over_keyof, Some((_, true)))
            && self
                .c
                .homomorphic_type_variable(file, node, mapper)
                .is_none()
            && self
                .c
                .homomorphic_type_variable(file, node, MapperId::IDENTITY)
                .is_some();
        let needs_modifier_preserving_wrapper =
            generates_names && matches!(over_keyof, Some((_, false))) && {
                let keys = self.c.mapped_keys(ty);
                !(matches!(self.c.data(keys), TypeData::TypeParam(..))
                    && self
                        .c
                        .constraint_of_type_param(keys)
                        .is_some_and(|constraint| {
                            matches!(self.c.data(constraint), TypeData::Keyof(_))
                        }))
            };
        let new_type_variable = if is_homomorphic_with_non_homomorphic_instantiation
            || needs_modifier_preserving_wrapper
        {
            let key = self.c.mapped_type_param(ty);
            self.new_type_parameter(key)
        } else {
            None
        };
        let new_name = new_type_variable.map(|variable| self.type_parameter_to_name(variable));
        let constraint = match (&new_name, over_keyof) {
            (Some(new_name), Some((_, true))) => cat!(b"keyof ", new_name),
            (Some(new_name), _) => new_name.clone(),
            // `isMappedTypeWithKeyofConstraintDeclaration`: `keyof` is preserved, whatever it
            // resolves to.
            (None, Some((declared, true))) => {
                let of = self.c.instantiate(declared, mapper);
                let of = self.type_to_node(of);
                cat!(b"keyof ", of.emit(TYPE_OPERATOR))
            }
            _ => {
                let keys = self.c.mapped_keys(ty);
                self.type_to_node(keys).text
            }
        };
        let parameter = self.c.mapped_type_param(ty);
        let outer_scope = self.enter_new_scope(&[], &[parameter], None, false);
        let name = if self.enclosing_declaration.is_some() {
            self.type_parameter_to_name(parameter)
        } else {
            self.name_of_type_parameter(parameter)
        };
        let renamed = match self.c.mapped_name_type(ty) {
            Some(name_type) => cat!(b" as ", self.type_to_node(name_type).text),
            None => Vec::new(),
        };
        let template = match (new_type_variable, over_keyof) {
            (Some(new_type_variable), Some((declared, true))) => {
                let target = self.c.type_from_node(file, node);
                let template = self.c.mapped_template(target);
                let target_parameter = self.c.mapped_type_param(target);
                let to_new_type_variable = self.c.mapper_from(
                    &[target_parameter, declared],
                    &[parameter, new_type_variable],
                );
                self.c.instantiate(template, to_new_type_variable)
            }
            _ => self.c.mapped_template(ty),
        };
        let template = self
            .c
            .remove_missing_type(template, mapped.optional == MappedModifier::Add);
        let template = self.type_to_node(template);
        self.leave_scope(&outer_scope);
        self.approximate_length += 10;
        let (readonly, question) = (mapped.readonly_text(), mapped.question_text());
        let result = cat! {
            b"{ ", readonly, b"[", name, b" in ", constraint, renamed, b"]", question, b": ",
            template.text, b"; }"
        };
        let (Some(new_name), Some((declared, is_declared_with_keyof)), Some(modifiers)) =
            (new_name, over_keyof, modifiers)
        else {
            return Node::simple(result);
        };
        let (check, infer_constraint) = if is_declared_with_keyof {
            let original_constraint = match self.c.constraint_of_type_param(declared) {
                Some(constraint) => self.c.instantiate(constraint, mapper),
                None => TypeId::UNKNOWN,
            };
            let original_constraint = if original_constraint == TypeId::UNKNOWN {
                Vec::new()
            } else {
                let constraint = self.type_to_node(original_constraint);
                cat!(b" extends ", constraint.emit_in_extends())
            };
            (self.type_to_node(modifiers), original_constraint)
        } else {
            let keys = self.c.mapped_keys(ty);
            let check = self.type_to_node(keys);
            let modifiers = self.type_to_node(modifiers);
            (
                check,
                cat!(b" extends keyof ", modifiers.emit(TYPE_OPERATOR)),
            )
        };
        Node::new(
            cat! {
                check.emit(UNION), b" extends infer ", new_name, infer_constraint, b" ? ", result,
                b" : never"
            },
            CONDITIONAL,
        )
    }

    /// `typeToTypeNodeOrCircularityElision`
    fn type_to_node_or_circularity_elision(&mut self, ty: TypeId) -> Node {
        if !self.c.is_union(ty) {
            return self.type_to_node(ty);
        }
        if self.visited_types.contains(&ty) {
            if self.flags & ALLOW_ANONYMOUS_IDENTIFIER == 0 {
                self.encountered_error = true;
                self.report(Report::CyclicStructure);
            }
            return self.elided_information_placeholder();
        }
        self.visit_and_transform_type(ty, None, Self::type_to_node)
    }

    /// `conditionalTypeToTypeNode` for the conditional type `ty` declared at `node`.
    fn conditional_type_to_node(&mut self, ty: TypeId, file: FileId, node: TypeNodeId) -> Node {
        let TypeNodeKind::Cond { extends, .. } = self.c.hir(file)[node].kind else {
            return self.elided_information_placeholder();
        };
        if self.check_truncation_length() {
            return self.elided_information_placeholder();
        }
        let check_type = self.c.cond_piece(ty, 0);
        let check = self.type_to_node(check_type);
        self.approximate_length += 15;
        let (_, _, mut mapper, nodes) = self.c.cond_origin(ty);
        // The check type was a type parameter and no longer is: a new type parameter keeps the type
        // distributive.
        let root_check_type = self.c.type_from_node(file, nodes[0]);
        let new_type_variable = if self.flags & GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS != 0
            && !self.c.is_type_param(check_type)
        {
            self.new_type_parameter(root_check_type)
        } else {
            None
        };
        let new_name = new_type_variable.map(|new_param| {
            self.approximate_length += 37;
            mapper = (self.c).prepend_type_mapping(root_check_type, new_param, mapper);
            self.type_parameter_to_name(new_param)
        });
        let piece = |printer: &mut Self, which: usize| {
            let declared = printer.c.type_from_node(file, nodes[which]);
            printer.c.instantiate(declared, mapper)
        };
        let mut declared = Vec::new();
        self.c.collect_infer_params(file, extends, &mut declared);
        let infer_type_parameters = declared
            .into_iter()
            .map(|parameter| self.c.type_param(file, parameter))
            .collect();
        let saved = std::mem::replace(&mut self.infer_type_parameters, infer_type_parameters);
        let extends = piece(self, 1);
        let extends = self.type_to_node(extends);
        self.infer_type_parameters = saved;
        let when_true = piece(self, 2);
        let when_true = self.type_to_node_or_circularity_elision(when_true);
        let when_false = piece(self, 3);
        let when_false = self.type_to_node_or_circularity_elision(when_false);
        let extends = extends.emit_in_extends();
        let (yes, no) = (when_true.text, when_false.text);
        let text = match new_name {
            // The first introduces `T` as a type parameter, the second constrains it to the check
            // type, the third is the test.
            Some(t) => {
                let constraint = check.clone().emit_in_extends();
                let check = check.emit(UNION);
                cat! {
                    check, b" extends infer ", t, b" ? ", t, b" extends ", constraint, b" ? ", t,
                    b" extends ", extends, b" ? ", yes, b" : ", no, b" : never : never"
                }
            }
            None => cat! { check.emit(UNION), b" extends ", extends, b" ? ", yes, b" : ", no },
        };
        Node::new(text, CONDITIONAL)
    }

    // ───────────────────────────── type nodes ─────────────────────────────

    /// The type of `node` instantiated with the mapper of the signature being printed.
    fn resolved_type_node_to_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        let declared = self.c.type_from_node(file, node);
        let ty = self.c.instantiate(declared, self.mapper);
        self.type_to_node(ty)
    }
}
