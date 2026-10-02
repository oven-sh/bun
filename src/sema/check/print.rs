//! Types, symbols and signatures as TypeScript writes them in messages.
//!
//! A port of what `typeToString`, `symbolToString` and `signatureToString` come to in `nodebuilderimpl.go` and the printer. There the
//! node builder makes syntax of a type and the printer writes the syntax out. Here a [`Node`] is the text of a type node, with the
//! precedence the printer parenthesizes it by.

use super::enclosing_declaration::Enclosing;

use super::errors_isolated_declarations::Node as SyntaxNode;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, ScopeId, ScopeKind, SymbolId};
use crate::resolve::remove_file_extension;
use bun_core::fmt::{ItoaBuf, VecWriter, digit_count, itoa};
use bun_core::lexer::is_identifier;
use bun_core::strings::{CodepointIterator, Cursor};
use core::fmt::Write;

/// The pieces, one after the other.
macro_rules! cat {
    ($($piece:expr),+ $(,)?) => { [$(&$piece[..]),+].concat() };
}

#[path = "print_node_reuse.rs"]
mod node_reuse;

/// `nodebuilder.Flags`, those that change what is written or reported.
const NO_TRUNCATION: u32 = 1 << 0;
pub(super) const USE_FULLY_QUALIFIED_TYPE: u32 = 1 << 1;
const ALLOW_UNIQUE_ES_SYMBOL_TYPE: u32 = 1 << 2;
const USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE: u32 = 1 << 3;
pub(super) const NO_TYPE_REDUCTION: u32 = 1 << 4;
const GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS: u32 = 1 << 5;
const IN_OBJECT_TYPE_LITERAL: u32 = 1 << 6;
const ALLOW_ANONYMOUS_IDENTIFIER: u32 = 1 << 7;
const ALLOW_NODE_MODULES_RELATIVE_PATHS: u32 = 1 << 8;
const ALLOW_THIS_IN_OBJECT_LITERAL: u32 = 1 << 9;
pub(super) const WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL: u32 = 1 << 10;
const USE_TYPE_OF_FUNCTION: u32 = 1 << 11;
const USE_STRUCTURAL_FALLBACK: u32 = 1 << 12;
/// What `typeToString` hands `typeToStringEx`.
pub(super) const TYPE_TO_STRING: u32 =
    ALLOW_UNIQUE_ES_SYMBOL_TYPE | USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE;
/// `declarationEmitNodeBuilderFlags`
pub(super) const DECLARATION_EMIT_NODE_BUILDER_FLAGS: u32 = WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL
    | USE_TYPE_OF_FUNCTION
    | USE_STRUCTURAL_FALLBACK
    | GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS
    | NO_TRUNCATION;
/// `FlagsIgnoreErrors`, which `typeToStringEx`, `symbolToStringEx` and `signatureToStringEx` add.
const IGNORE_ERRORS: u32 =
    ALLOW_ANONYMOUS_IDENTIFIER | ALLOW_NODE_MODULES_RELATIVE_PATHS | ALLOW_THIS_IN_OBJECT_LITERAL;
/// Not of `nodebuilder.Flags`: the type that is asked about has no `alias`. What it is made of goes by what it goes by.
const WRITTEN_OUT: u32 = 1 << 16;

const DEFAULT_MAXIMUM_TRUNCATION_LENGTH: usize = 160;
const NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH: usize = 1_000_000;

/// How deep types are gone into whatever they are. TypeScript has no such limit.
const MAXIMUM_DEPTH: u32 = 150;

/// `ast.TypePrecedence`
const CONDITIONAL: u8 = 0;
const FUNCTION: u8 = 2;
const UNION: u8 = 3;
const INTERSECTION: u8 = 4;
const TYPE_OPERATOR: u8 = 5;
const POSTFIX: u8 = 6;
const NON_ARRAY: u8 = 7;

thread_local! {
    /// `Checker.varianceTypeParameter`: its name.
    static VARIANCE_TYPE_PARAMETER: std::cell::Cell<Atom> = const { std::cell::Cell::new(Atom::NONE) };
}

impl Checker<'_> {
    /// `DeclarationNameToString(GetNonAssignedNameOfDeclaration(e))`, of an assignment or a call that declares a property.
    pub(super) fn name_of_assignment_declaration(&self, file: FileId, e: ExprId) -> Option<String> {
        let hir = self.hir(file);
        let name = match hir[e].kind {
            // `module.exports = value` has no name.
            ExprKind::Assign { .. }
                if crate::bind::assignment_declaration_kind(hir, e)
                    == crate::bind::JsDeclarationKind::ModuleExports =>
            {
                return None;
            }
            // `GetElementOrPropertyAccessName`, or else all of the left side.
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

    /// What `write` writes, as a `String`. It goes with the eight that call it, each of which goes with its last caller: a diagnostic takes an `Arg`.
    fn printed(&mut self, write: impl FnOnce(&mut Self, &mut Vec<u8>)) -> String {
        let mut out = Vec::new();
        write(self, &mut out);
        to_valid_utf8(out)
    }

    /// `typeToString`
    pub fn type_to_string(&mut self, ty: TypeId) -> String {
        self.printed(|c, out| c.write_type(out, ty, TYPE_TO_STRING))
    }

    /// `TypeToTypeNode` with the flags of `typeWriterWalker.writeTypeOrSymbol`.
    pub(super) fn type_to_string_for_baseline_with(
        &mut self,
        ty: TypeId,
        enclosing_declaration: Option<Enclosing>,
    ) -> String {
        // `writeTypeOrSymbol` does not ask the node builder about it in a test without errors.
        if ty == TypeId::ERROR {
            return super::type_writer::ERROR_TYPE_TEXT.to_owned();
        }
        let flags = NO_TRUNCATION
            | ALLOW_UNIQUE_ES_SYMBOL_TYPE
            | GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS
            | IGNORE_ERRORS;
        to_valid_utf8(self.type_to_type_node(ty, enclosing_declaration, flags, None))
    }

    /// `getTypeNameForErrorDisplay`
    pub fn type_to_string_fully_qualified(&mut self, ty: TypeId) -> String {
        self.printed(|c, out| c.write_type(out, ty, USE_FULLY_QUALIFIED_TYPE))
    }

    /// `typeToStringEx(t, nil, TypeFormatFlagsNoTypeReduction)`: an intersection nothing can be is written out, not as `never`.
    pub fn type_to_string_without_reduction(&mut self, ty: TypeId) -> String {
        self.printed(|c, out| c.write_type(out, ty, NO_TYPE_REDUCTION))
    }

    /// `typeToString` of a type that is made of what `ty` is made of and has no `alias`.
    pub fn type_to_string_written_out(&mut self, ty: TypeId) -> String {
        self.printed(|c, out| c.write_type(out, ty, TYPE_TO_STRING | WRITTEN_OUT))
    }

    /// `t.symbol.ValueDeclaration`, if that is an expression (`ast.IsExpression`), and the scope names are looked up in from it.
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

    /// `typeToString(t, t.symbol.ValueDeclaration)` if `symbolValueDeclarationIsContextSensitive`, which says the opposite of its
    /// name. Otherwise `typeToString(t)`.
    fn type_to_string_where_it_is_declared(&mut self, ty: TypeId) -> Vec<u8> {
        let enclosing_declaration = self
            .value_declaration_expression_of_type(ty)
            .filter(|&(file, e, _)| !self.is_context_sensitive(file, e))
            .map(|(file, _, scope)| Enclosing::at_scope(file, scope));
        type_to_string_with(self, ty, enclosing_declaration, TYPE_TO_STRING)
    }

    /// `getTypeNamesForErrorDisplay`: both, with qualified names if they would read the same.
    pub fn type_names_for_error_display(
        &mut self,
        left: TypeId,
        right: TypeId,
    ) -> (String, String) {
        let (left_text, right_text) = (
            self.type_to_string_where_it_is_declared(left),
            self.type_to_string_where_it_is_declared(right),
        );
        if left_text != right_text {
            return (to_valid_utf8(left_text), to_valid_utf8(right_text));
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
    pub fn symbol_to_string(&mut self, symbol: Sym) -> String {
        self.printed(|c, out| c.write_symbol(out, symbol))
    }

    /// `getNameOfSymbolAsWritten`, of the symbol of the function expression or arrow function `e`, which has no `Sym`.
    pub(super) fn name_of_function_expression(&mut self, file: FileId, e: ExprId) -> String {
        to_valid_utf8(with_printer(self, None, None, 0, |printer| {
            printer
                .name_of_initialized_variable(file, e)
                .unwrap_or_else(|| b"(Anonymous function)".to_vec())
        }))
    }

    /// `symbolToString`, of a property.
    pub(super) fn write_prop(&mut self, out: &mut Vec<u8>, prop: &Prop) {
        let mut text = with_printer(self, None, None, IGNORE_ERRORS, |printer| {
            printer.name_of_property_as_written(prop, 0)
        });
        out.append(&mut text);
    }

    /// `symbolToString`, of a property.
    pub fn prop_to_string(&mut self, prop: &Prop) -> String {
        self.printed(|c, out| c.write_prop(out, prop))
    }

    /// `signatureToString`. It is cut short whatever `noErrorTruncation` says.
    pub(super) fn write_signature(&mut self, out: &mut Vec<u8>, signature: SigId) {
        let kind = match *self.p.types.sig(self.p.types.sig_origin(signature)) {
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
        let mut text = with_printer(self, None, None, IGNORE_ERRORS, |printer| {
            printer.signature_to_text(signature, kind, b"", false)
        });
        out.append(&mut text);
    }

    /// `signatureToString`
    pub fn signature_to_string(&mut self, signature: SigId) -> String {
        self.printed(|c, out| c.write_signature(out, signature))
    }

    /// `t.alias`, as far as it can be told: the type alias `type_to_string` names `ty` by. `None`: it writes `ty` out.
    pub fn alias_for_display(&mut self, ty: TypeId) -> Option<Sym> {
        self.alias_of_type(ty).map(|alias| alias.0)
    }

    /// `c.varianceTypeParameter = parameter`: the type parameter `sub-T` and `super-T` are named after, for as long as the error of
    /// a variance annotation is put into words.
    pub fn set_variance_type_parameter(&mut self, parameter: Option<TypeId>) {
        let name = parameter
            .and_then(|parameter| self.type_param_name(parameter))
            .unwrap_or(Atom::NONE);
        VARIANCE_TYPE_PARAMETER.with(|current| current.set(name));
    }
}

impl<'p> Checker<'p> {
    /// `NodeBuilder.SerializeTypeForDeclaration`, of a declaration of `file`. `ty`: `getTypeOfSymbol(symbol)`. `declaration`: none
    /// if nothing is read off its syntax.
    pub(super) fn serialize_type_for_declaration(
        &mut self,
        file: FileId,
        declaration: Option<SyntaxNode>,
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
                        true,
                        false,
                        false,
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
            |printer| {
                let (declared, _, outer_scope) = printer.enter_signature_scope(signature);
                let text = printer.return_type_text(signature, &declared, true);
                printer.leave_scope(outer_scope);
                text
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

/// `typeToStringEx`
fn type_to_string_with(
    checker: &mut Checker<'_>,
    ty: TypeId,
    enclosing_declaration: Option<Enclosing>,
    flags: u32,
) -> Vec<u8> {
    let no_truncation = checker.files().options.no_error_truncation;
    let flags = if no_truncation {
        flags | NO_TRUNCATION
    } else {
        flags
    } | IGNORE_ERRORS;
    let text = with_printer(checker, enclosing_declaration, None, flags, |printer| {
        printer.type_to_node(ty).text
    });
    let maximum = 2 * if no_truncation {
        NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH
    } else {
        DEFAULT_MAXIMUM_TRUNCATION_LENGTH
    };
    if text.len() < maximum {
        return text;
    }
    let mut end = maximum - b"...".len();
    while text[end] & 0xC0 == 0x80 {
        end -= 1;
    }
    cat!(text[..end], b"...")
}

/// `strings.ToValidUTF8(text, "\uFFFD")`, for who still takes a `String`.
pub(super) fn to_valid_utf8(text: Vec<u8>) -> String {
    String::from_utf8(text)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

/// Printing resolves what it comes across. A circle that goes through here is nobody's error, and what the check under way has found
/// out so far stays what it was.
fn with_printer<'p, T>(
    checker: &mut Checker<'p>,
    enclosing_declaration: Option<Enclosing>,
    tracker: Option<&mut dyn SymbolTracker<'p>>,
    flags: u32,
    print: impl FnOnce(&mut Printer<'_, 'p>) -> T,
) -> T {
    let saved = (checker.relation_gave_up, checker.relation_too_complex);
    let is_barrier = !std::mem::take(&mut checker.printing_closes_circles);
    if is_barrier {
        checker.eager.push(checker.stack.len());
    }
    let result = {
        let mut printer = Printer {
            c: &mut *checker,
            flags,
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
    (checker.relation_gave_up, checker.relation_too_complex) = saved;
    result
}

/// A type node as the printer writes it.
#[derive(Clone)]
struct Node {
    text: Vec<u8>,
    /// `GetTypeNodePrecedence`
    precedence: u8,
    /// `isIdentifierTypeReference`: the name, of a type reference whose name is one identifier.
    reference: Option<Vec<u8>>,
    /// `UnionTypeNode.Types`, each as it is emitted.
    types: Vec<Vec<u8>>,
}

impl Node {
    fn new(text: impl Into<Vec<u8>>, precedence: u8) -> Node {
        Node {
            text: text.into(),
            precedence,
            reference: None,
            types: Vec::new(),
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

/// How one declaration of a property writes its name.
#[derive(Copy, Clone)]
struct WrittenName {
    is_string: bool,
    is_single_quoted: bool,
    /// The property has a `nameType`.
    is_computed: bool,
}

/// Where a property is declared, as `compareSymbols` wants to know.
enum Place {
    At((bool, u32, u32)),
    /// It has no declaration.
    Nowhere,
}

/// `NodeBuilderImpl` and its `NodeBuilderContext`.
/// A call of `ReportCyclicStructureError`, `ReportInaccessibleThisError`, `ReportInaccessibleUniqueSymbolError`,
/// `ReportLikelyUnsafeImportRequiredError`, `ReportNonSerializableProperty` or `ReportPrivateInBaseOfClassExpression`: those a
/// `wrappingTracker` puts off (`deferredReports`).
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

/// `nodebuilder.SymbolTracker`, what the node builder calls of it. It is handed the checker, which the printer has while it runs.
pub(super) trait SymbolTracker<'p> {
    /// `TrackSymbol`. Whether a diagnostic is reported.
    fn track_symbol(
        &mut self,
        c: &mut Checker<'p>,
        symbol: Sym,
        enclosing_declaration: Option<Enclosing>,
        meaning: SymFlags,
    ) -> bool;
    fn report(&mut self, c: &mut Checker<'p>, report: Report);
    /// `ReportInferenceFallback`, of `node` of `file`.
    fn report_inference_fallback(&mut self, c: &mut Checker<'p>, file: FileId, node: SyntaxNode);
    /// `ReportTruncationError`
    fn report_truncation_error(&mut self, c: &mut Checker<'p>);
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
    /// Set by a report, and where the visitor gives a node up for good. Otherwise the visitor comes back with `None`.
    had_error: bool,
    tracked_symbols: Vec<TrackedSymbolArgs>,
    deferred_reports: Vec<Report>,
    old_tracked_symbols: Vec<TrackedSymbolArgs>,
    old_encountered_error: bool,
}

/// `SerializedTypeEntry`
#[derive(Clone)]
struct SerializedTypeEntry {
    node: Node,
    truncating: bool,
    added_length: usize,
    tracked_symbols: Vec<TrackedSymbolArgs>,
}

/// What `enterNewScope` gives back, to leave the scope by.
#[derive(Copy, Clone)]
struct OuterScope {
    type_parameter_names: usize,
    type_parameter_name_counts: usize,
    fake_scope_type_parameters: usize,
    fake_scope_parameters: usize,
    enclosing_declaration: Option<Enclosing>,
    has_fake_scope: [bool; 2],
    mapper: MapperId,
}

struct Printer<'c, 'p> {
    c: &'c mut Checker<'p>,
    flags: u32,
    approximate_length: usize,
    truncating: bool,
    visited_types: Vec<TypeId>,
    symbol_depth: Vec<(Identity, u32)>,
    infer_type_parameters: Vec<TypeId>,
    reverse_mapped_stack: Vec<ReverseMappedProperty>,
    /// The mapper of the innermost instantiated signature being written.
    mapper: MapperId,
    /// `enclosingSymbolTypes`, of the declarations of signatures: what each returns, while that is written from its syntax.
    enclosing_symbol_types: Vec<((FileId, FnId), TypeId)>,
    depth: u32,
    /// `enclosingDeclaration`: the scope names are looked up from. `None` in error messages.
    enclosing_declaration: Option<Enclosing>,
    /// `SymbolTrackerImpl.inner`, under all the `wrappingTracker`s there are.
    tracker: Option<&'c mut dyn SymbolTracker<'p>>,
    /// `wrappingTracker.bound`, of each of those.
    boundaries: Vec<RecoveryBoundary>,
    /// `suppressReportInferenceFallback`
    suppress_report_inference_fallback: bool,
    reported_diagnostic: bool,
    encountered_error: bool,
    tracked_symbols: Vec<TrackedSymbolArgs>,
    /// `links.serializedTypes`, of every enclosing declaration there is while this printer runs.
    serialized_types: FxHashMap<(TypeId, u32, Enclosing), SerializedTypeEntry>,
    /// Whether a block for the parameters, and one for the type parameters, is among the enclosing declarations
    /// (`fakeScopeForSignatureDeclaration`).
    has_fake_scope: [bool; 2],
    /// How many blocks have been made up.
    fake_scope_count: u32,
    /// `typeParameterNames` and `typeParameterNamesByText`. A later entry hides an earlier one, here and in the next two.
    type_parameter_names: Vec<(TypeId, Vec<u8>)>,
    /// `typeParameterNamesByTextNextNameCount`
    type_parameter_name_counts: Vec<(Vec<u8>, u32)>,
    /// The locals of the fake scopes `enterNewScope` puts in front of `enclosing_declaration` that a search for a type finds: type
    /// parameters, and parameters that are one symbol with a type parameter. `None`: such a parameter after `instantiateSymbol`.
    fake_scope_type_parameters: Vec<(Vec<u8>, Option<TypeId>)>,
    /// The locals of the fake scope of the parameters, as a search for a value finds them. `None`: after `instantiateSymbol`.
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
        // `DecodeJSStringRune`: half a surrogate pair is a code point, a byte that is no UTF-8 is U+FFFD.
        let (ch, is_malformed) = (cursor.c as u32, cursor.width == 1 && byte >= 0x80);
        match byte {
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'$' if quote == b'`' && next == Some(b'{') => out.extend_from_slice(b"\\$"),
            b'"' | b'\'' | b'`' if byte == quote => out.extend_from_slice(&[b'\\', byte]),
            // The line feed after it goes with it, in a template too.
            b'\r' if quote == b'`' && next == Some(b'\n') => {
                cursor.width += 1;
                out.extend_from_slice(b"\\r\\n");
            }
            b'\r' => out.extend_from_slice(b"\\r"),
            // A template keeps its line feeds.
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

/// A string literal. `escapes_non_ascii`: it is written without `EFNoAsciiEscaping`.
pub(super) fn quoted(text: &[u8], quote: u8, escapes_non_ascii: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(quote);
    escape_string(text, quote, escapes_non_ascii, &mut out);
    out.push(quote);
    out
}

fn string_mapping_name(kind: StringMappingKind) -> &'static [u8] {
    match kind {
        StringMappingKind::Uppercase => b"Uppercase",
        StringMappingKind::Lowercase => b"Lowercase",
        StringMappingKind::Capitalize => b"Capitalize",
        StringMappingKind::Uncapitalize => b"Uncapitalize",
    }
}

impl Checker<'_> {
    /// What `typeof` names a `unique symbol` through: the variable that is declared as one, the class it is a static property of, the
    /// variable whose type is written as the type literal it is a property of. `Some(None)`: nothing. `None`: it cannot be told,
    /// or it is a property of the global `Symbol`.
    pub(super) fn owner_of_unique_symbol(
        &self,
        symbol: UniqueSymbolDeclaration,
    ) -> Option<Option<Sym>> {
        let (file, m) = match symbol {
            UniqueSymbolDeclaration::Variable(variable) => return Some(Some(variable)),
            UniqueSymbolDeclaration::Member(file, m) => (file, m),
            UniqueSymbolDeclaration::SymbolConstructor => return None,
        };
        let files = self.files();
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol_of = |pat: PatId| {
            let symbol = bound.pat_symbol[pat.idx()];
            symbol.is_some().then(|| files.sym(file, symbol))
        };
        match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => {
                let symbol = bound.class_symbol[c.idx()];
                symbol.is_some().then(|| Some(files.sym(file, symbol)))
            }
            // `getVariableDeclarationOfObjectLiteral`
            MemberOwner::TypeLiteral(node) => Some(
                hir.var_decls
                    .iter()
                    .find(|d| d.ty == node)
                    .and_then(|d| symbol_of(d.pat)),
            ),
            _ => None,
        }
    }
}

impl<'p> Printer<'_, 'p> {
    fn text(&self, name: Atom) -> Vec<u8> {
        self.c.files().atoms.bytes(name).to_vec()
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
        // Type parameters have no part in what is painted late.
        if !self
            .c
            .flags_of(tracked.symbol)
            .contains(SymFlags::TYPE_PARAMETER)
        {
            self.tracked_symbols.push(tracked);
        }
    }

    /// What `wrappingTracker` and `SymbolTrackerImpl` do with the calls `Report` stands for.
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

    /// `ReportInferenceFallback`, which does not wait.
    fn report_inference_fallback(&mut self, file: FileId, node: SyntaxNode) {
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
            ..RecoveryBoundary::default()
        });
    }

    /// `finalizeBoundary`. `had_error`: the visitor came back with `None`.
    fn finalize_boundary(&mut self, had_error: bool) -> bool {
        let Some(boundary) = self.boundaries.pop() else {
            return !had_error;
        };
        self.tracked_symbols = boundary.old_tracked_symbols;
        self.encountered_error = boundary.old_encountered_error;
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

    /// `...`. Without truncation it is `any` with a comment, and comments are not written.
    fn elision(&self) -> Node {
        Node::simple(if self.flags & NO_TRUNCATION != 0 {
            b"any"
        } else {
            b"..."
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
                    | Intrinsic::Wildcard => (b"any", 3),
                    Intrinsic::IntrinsicMarker => (b"intrinsic", 3),
                    Intrinsic::Unknown => (b"unknown", 0),
                    Intrinsic::Never
                    | Intrinsic::SilentNever
                    | Intrinsic::UnreachableNever
                    | Intrinsic::ImplicitNever => (b"never", 5),
                    Intrinsic::Void => (b"void", 4),
                    Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => {
                        (b"undefined", 9)
                    }
                    Intrinsic::Null | Intrinsic::NullDeclared => (b"null", 4),
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
                let value = self.c.files().atoms.bytes(*value);
                self.approximate_length += value.len() + 2;
                return Node::simple(quoted(value, b'"', false));
            }
            TypeData::NumberLit { bits, .. } => {
                let text = crate::atom::number_to_string(f64::from_bits(*bits)).into_bytes();
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
                let (symbol, name) = (*symbol, *name);
                if self.flags & ALLOW_UNIQUE_ES_SYMBOL_TYPE == 0 {
                    if let Some(node) = self.unique_symbol_to_type_query(symbol, name) {
                        return node;
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
            // `typeToTypeNode`: an `any` with an alias is written as the alias.
            TypeData::UnresolvedName { name, args } => {
                let name = self.text(*name);
                let arguments = self.map_to_type_nodes(args, false);
                return Node::simple(cat!(name, type_arguments_text(arguments)));
            }
            _ => {}
        }
        let is_written_out = self.flags & WRITTEN_OUT != 0 && self.depth == 1;
        if !is_written_out
            && let Some((alias, arguments)) = self.c.alias_of_type(ty)
            && (self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE != 0
                || self.is_type_symbol_accessible(alias))
        {
            let arguments = self.map_to_type_nodes(&arguments, false);
            return self.symbol_to_type_node(alias, false, arguments);
        }
        // `t.AsTypeReference().node != nil`
        let node_of_reference = self
            .c
            .p
            .types
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
                self.intrinsic_alias_to_node(string_mapping_name(*kind), of)
            }
            TypeData::Substitution { base, constraint } => {
                let base = self.type_to_node(*base);
                if *constraint != TypeId::UNKNOWN {
                    return base;
                }
                self.intrinsic_alias_to_node(b"NoInfer", base)
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

    /// `symbolToTypeNode(t.symbol, SymbolFlagsValue)` of a `unique symbol`. `None`: `IsValueSymbolAccessible` says no.
    fn unique_symbol_to_type_query(
        &mut self,
        symbol: UniqueSymbolDeclaration,
        name: Atom,
    ) -> Option<Node> {
        let name = self.text(name);
        if symbol == UniqueSymbolDeclaration::SymbolConstructor {
            self.approximate_length += 6 + 2 * (b"Symbol".len() + 1) + 2 * (name.len() + 1);
            return Some(Node::new(cat!(b"typeof Symbol.", name), TYPE_OPERATOR));
        }
        // A member has no symbol: it is as accessible as what it is a member of, and is reached through that.
        let owner = match self.c.owner_of_unique_symbol(symbol) {
            Some(owner) if self.enclosing_declaration.is_some() => owner?,
            _ => {
                self.approximate_length += 6 + 2 * (name.len() + 1);
                return Some(Node::new(cat!(b"typeof ", name), TYPE_OPERATOR));
            }
        };
        if !self.is_value_symbol_accessible(owner) {
            return None;
        }
        self.approximate_length += 6;
        let node = self.symbol_to_type_node(owner, true, Vec::new());
        if matches!(symbol, UniqueSymbolDeclaration::Variable(_)) {
            return Some(node);
        }
        self.approximate_length += name.len() + 1;
        Some(Node::new(cat!(node.text, b".", name), TYPE_OPERATOR))
    }

    /// `IsValueSymbolAccessible(symbol, enclosingDeclaration)`
    fn is_value_symbol_accessible(&mut self, symbol: Sym) -> bool {
        match self.enclosing_declaration {
            Some(at) => self
                .c
                .is_symbol_accessible_at(symbol, SymFlags::VALUE, false, at),
            None => true,
        }
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
    fn intrinsic_alias_to_node(&mut self, name: &[u8], argument: Node) -> Node {
        self.approximate_length += 2 * (name.len() + 1);
        Node::simple(cat!(name, b"<", argument.text, b">"))
    }

    /// The name of a type parameter that has no symbol.
    fn name_of_marker(&self, marker: Marker) -> Vec<u8> {
        let parameter = VARIANCE_TYPE_PARAMETER.with(std::cell::Cell::get);
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
        let key = self
            .enclosing_declaration
            .map(|enclosing_declaration| (ty, self.flags, enclosing_declaration));
        if let Some(key) = &key
            && let Some(cached) = self.serialized_types.get(key)
        {
            let cached = cached.clone();
            for tracked in cached.tracked_symbols {
                self.track(tracked);
            }
            self.truncating |= cached.truncating;
            self.approximate_length += cached.added_length;
            return cached.node;
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
                        return self.elided_information_placeholder();
                    }
                    entry.1 = depth + 1;
                }
                None => self.symbol_depth.push((identity, 1)),
            }
        }
        self.visited_types.push(ty);
        let previous_tracked_symbols = std::mem::take(&mut self.tracked_symbols);
        let start_length = self.approximate_length;
        let node = transform(self, ty);
        let added_length = self.approximate_length.saturating_sub(start_length);
        let tracked_symbols =
            std::mem::replace(&mut self.tracked_symbols, previous_tracked_symbols);
        if let Some(key) = key
            && !self.reported_diagnostic
            && !self.encountered_error
        {
            self.serialized_types.insert(
                key,
                SerializedTypeEntry {
                    node: node.clone(),
                    truncating: self.truncating,
                    added_length,
                    tracked_symbols,
                },
            );
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

    /// `E.A`, or `E` if the member is all there is to the enum.
    fn enum_member_to_node(&mut self, ty: TypeId, member: Sym) -> Node {
        let Some(parent) = self.c.files().parent_of_symbol(member) else {
            return self.symbol_to_type_node(member, false, Vec::new());
        };
        let parent_name = self.symbol_to_type_node(parent, false, Vec::new());
        if self.c.enum_type_of_member(member) == ty {
            return parent_name;
        }
        let name = match self.c.files().symbol(member).name {
            // `InternalSymbolNamePrefix` is no UTF-8.
            known::missing => b"\xEF\xBF\xBDmissing".to_vec(),
            name => self.text(name),
        };
        if is_identifier(&name) {
            return Node::simple(cat!(parent_name.text, b".", name));
        }
        let literal = quoted(&name, b'"', true);
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

    /// `getSpecifierForModuleSymbol` without an enclosing file: the name of the symbol without its quotes.
    fn specifier_of_module(&self, symbol: Sym) -> Vec<u8> {
        let files = self.c.files();
        let decls = files.decls(symbol);
        if let Some(&(file, _)) = decls.iter().find(|d| d.1 == Decl::File) {
            return remove_file_extension(&files.module(file).path).to_owned();
        }
        for &(file, decl) in &decls {
            if let Decl::Module(m) = decl
                && let ModuleName::String(name) = self.c.hir(file)[m].name
            {
                return self.text(name);
            }
        }
        Vec::new()
    }

    /// Whether `symbol.Name` is `default`. A class declaration without a name that is no default export is kept under that name too,
    /// and has no parent.
    fn is_default_export(&self, symbol: Sym) -> bool {
        let declared = self.c.files().symbol(symbol);
        declared.name == known::default && declared.parent.is_some()
    }

    /// The string, the number or the `[computed]` name written at `pos`, as it is written. `None`: something else is written there,
    /// or the text of the file is not kept. `is_computed`: `pos` may be that of the expression in the brackets.
    fn written_literal_name(&self, file: FileId, pos: u32, is_computed: bool) -> Option<Vec<u8>> {
        let text = &self.c.hir(file).text[..];
        let mut start = pos as usize;
        if is_computed && text.get(start) != Some(&b'[') {
            let mut before = start.min(text.len());
            while before > 0 && (text[before - 1].is_ascii_whitespace() || text[before - 1] == b'(')
            {
                before -= 1;
            }
            if before == 0 || text[before - 1] != b'[' {
                return None;
            }
            start = before - 1;
        }
        let end = match *text.get(start)? {
            b'[' | b'"' | b'\'' | b'0'..=b'9' => self.c.end_of_name_at(file, start as u32) as usize,
            _ => return None,
        };
        let end = end.clamp(start, text.len());
        Some(text[start..end].to_vec())
    }

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

    /// `GetTextOfNode`, of the name at `start`, if that says more than its atom: the unicode escapes of an identifier, the quotes of a
    /// `ModuleExportName`.
    fn text_of_name_at(&self, file: FileId, start: u32) -> Option<Vec<u8>> {
        self.text_of_name(file, start, self.c.end_of_token_at(file, start))
    }

    /// The same, of the name from `start` to `end`.
    fn text_of_name(&self, file: FileId, start: u32, end: u32) -> Option<Vec<u8>> {
        let written = self.c.hir(file).text.get(start as usize..end as usize)?;
        (written.contains(&b'\\') || matches!(written.first(), Some(b'"' | b'\'')))
            .then(|| written.to_vec())
    }

    /// `DeclarationNameToString`, of the name `key` written at `pos`.
    fn declaration_name_to_string(&self, file: FileId, key: PropKey, pos: u32) -> Vec<u8> {
        match key {
            // `pos` may be that of the expression in the brackets.
            PropKey::Computed(_) => None,
            _ => self.text_of_name_at(file, pos),
        }
        .unwrap_or_else(|| self.property_key_text(file, key, pos))
    }

    /// The same of a clone of the name, which the printer gives its `node.Text()`: an identifier is without its escapes.
    fn property_key_text(&self, file: FileId, key: PropKey, pos: u32) -> Vec<u8> {
        if let Some(text) =
            self.written_literal_name(file, pos, matches!(key, PropKey::Computed(_)))
        {
            return text;
        }
        match key {
            PropKey::Name(known::empty) => b"(Missing)".to_vec(),
            PropKey::Name(name) => {
                let name = self.text(name);
                let is_bare = is_identifier(&name)
                    || name.first().is_some_and(u8::is_ascii_digit)
                    // The name of a JSX attribute.
                    || !self.c.hir(file).text.is_empty();
                if is_bare {
                    name
                } else {
                    quoted(&name, b'"', false)
                }
            }
            PropKey::Private(name) => self.c.written_name(name).to_vec(),
            PropKey::Computed(e) => match self.entity_name_text(file, e) {
                Some(name) => cat!(b"[", name, b"]"),
                None => b"(Missing)".to_vec(),
            },
            // A name that names nothing (`getDeclarationName`), as it is written: `#x` with no class around it.
            PropKey::None if is_private_name_at(self.c.hir(file), pos) => self
                .c
                .source_text(file, pos, self.c.end_of_name_at(file, pos))
                .into_bytes(),
            PropKey::None => b"(Missing)".to_vec(),
        }
    }

    /// `DeclarationNameToString(GetNameOfDeclaration(decl))`
    fn name_of_declaration(&self, file: FileId, decl: Decl) -> Option<Vec<u8>> {
        let hir = self.c.hir(file);
        let name = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => match hir[pat].kind {
                PatKind::Ident(name) => name,
                _ => Atom::NONE,
            },
            Decl::Fn(function) => hir[function].name,
            Decl::Class(class) => hir[class].name,
            Decl::Interface(interface) => hir[interface].name,
            Decl::Alias(alias) => hir[alias].name,
            Decl::Enum(enumeration) => hir[enumeration].name,
            // `[e]`, which is an error: as it is written.
            Decl::EnumMember(member) if hir[member].name.is_none() => {
                let start = hir[member].pos;
                let end = self.c.end_of_name_at(file, start);
                return Some(self.c.source_text(file, start, end).into_bytes());
            }
            Decl::EnumMember(member) => {
                return Some(self.declaration_name_to_string(
                    file,
                    PropKey::Name(hir[member].name),
                    hir[member].pos,
                ));
            }
            Decl::Module(module) => match hir[module].name {
                ModuleName::Ident(name) => name,
                ModuleName::String(name) => {
                    return Some(
                        self.written_literal_name(file, hir[module].name_pos, false)
                            .unwrap_or_else(|| quoted(&self.text(name), b'"', false)),
                    );
                }
                ModuleName::Global => known::global,
            },
            Decl::TypeParam(parameter) => hir[parameter].name,
            Decl::ImportDefault(import) => hir[import].default,
            Decl::ImportNamespace(import) => hir[import].namespace,
            Decl::ImportSpec(specifier) => hir[specifier].local,
            Decl::ImportEquals(import) => hir[import].name,
            Decl::ExportSpec(specifier) => hir[specifier].exported,
            Decl::ExportStarAs(statement)
            | Decl::ExportExpr(statement)
            | Decl::UmdGlobal(statement) => match hir[statement].kind {
                StmtKind::ExportStar { alias, .. } => alias,
                StmtKind::ExportAsNamespace(name) => name,
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => match hir[e].kind {
                    ExprKind::Ident(name) => name,
                    _ => Atom::NONE,
                },
                _ => Atom::NONE,
            },
            Decl::ExportsProperty(e) | Decl::Expando(e) => {
                return self
                    .c
                    .name_of_assignment_declaration(file, e)
                    .map(String::into_bytes);
            }
            _ => Atom::NONE,
        };
        if name.is_none() {
            return None;
        }
        if let Some(text) = self
            .c
            .declaration_name_start(file, decl)
            .and_then(|start| self.text_of_name_at(file, start))
        {
            return Some(text);
        }
        if name == known::empty {
            return Some(b"(Missing)".to_vec());
        }
        Some(self.text(name))
    }

    /// `DeclarationNameToString(GetAssignedName(e))`: the name of what `e` is given to.
    fn name_of_initialized_variable(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let parent = bound.expr_parent[e.idx()];
        // What is in parentheses is given to nothing.
        if is_parenthesized(self.c.hir(file), e) {
            return None;
        }
        if let Parent::VarInit(declaration) = parent {
            return match hir[hir[declaration].pat].kind {
                PatKind::Ident(name) => Some(self.text(name)),
                _ => None,
            };
        }
        let written = |pat: PatId| {
            self.c
                .source_text(file, hir[pat].pos, self.c.end_of_pat(file, pat))
                .into_bytes()
        };
        match parent {
            // Not the attribute of a JSX element.
            Parent::Prop(p)
                if hir[p].kind == PropKind::Init
                    && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
            {
                Some(self.declaration_name_to_string(file, hir[p].key, hir[p].pos))
            }
            Parent::PatPropDefault(p) => Some(written(hir[p].value)),
            Parent::PatElemDefault(p) => Some(written(hir[p].pat)),
            Parent::Expr(outer) if outer.is_some() => {
                // `{ a = e }` is a `ShorthandPropertyAssignment`.
                if matches!(bound.expr_parent[outer.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
                {
                    return None;
                }
                let left = match hir[outer].kind {
                    ExprKind::Assign { target, value, .. } if value == e => target,
                    ExprKind::Binary { left, right, .. } if right == e => left,
                    _ => return None,
                };
                if is_parenthesized(self.c.hir(file), left) {
                    return None;
                }
                match hir[left].kind {
                    ExprKind::Ident(name) | ExprKind::Dot { name, .. } => Some(self.text(name)),
                    ExprKind::Index { index, .. }
                        if matches!(hir[index].kind, ExprKind::String(_) | ExprKind::Number(_)) =>
                    {
                        let end = self.c.end_inside_parentheses(file, index);
                        Some(self.c.source_text(file, hir[index].pos, end).into_bytes())
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// `getNameOfSymbolAsWritten`. `is_initial`: `FlagsInInitialEntityName`.
    fn name_of_symbol_as_written(&self, symbol: Sym, is_initial: bool) -> Vec<u8> {
        let files = self.c.files();
        let decls = files.decls(symbol);
        let is_default = self.is_default_export(symbol);
        if is_default
            && self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0
            && (!is_initial || decls.is_empty())
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
                    return self
                        .name_of_initialized_variable(file, e)
                        .unwrap_or_else(|| b"(Anonymous class)".to_vec());
                }
            }
            Some(&(file, Decl::Fn(function))) => {
                if let FnOwner::Expr(e) = self.c.bound(file).fns[function.idx()].owner {
                    return self
                        .name_of_initialized_variable(file, e)
                        .unwrap_or_else(|| b"(Anonymous function)".to_vec());
                }
            }
            Some(&(file, Decl::File)) => {
                return cat! { b"\"", remove_file_extension(&files.module(file).path), b"\"" };
            }
            _ => {}
        }
        if is_default {
            return b"default".to_vec();
        }
        let name = files.symbol(symbol).name;
        if name.is_some() {
            return files.atoms.bytes(name).to_vec();
        }
        match decls.first() {
            Some(&(_, Decl::Class(_))) => b"__class".to_vec(),
            Some(&(_, Decl::Fn(_))) => b"__function".to_vec(),
            _ => b"__type".to_vec(),
        }
    }

    /// The name `symbol` goes by in the exports of its parent.
    fn export_name(&self, symbol: Sym) -> Vec<u8> {
        if self.is_default_export(symbol) {
            return b"default".to_vec();
        }
        let name = self.c.files().symbol(symbol).name;
        if name.is_some() {
            self.text(name)
        } else {
            self.name_of_symbol_as_written(symbol, false)
        }
    }

    /// `symbolToExpression` of a chain of one, as `symbolToString` has it.
    fn symbol_to_text(&mut self, symbol: Sym) -> Vec<u8> {
        let name = self.name_of_symbol_as_written(symbol, true);
        if matches!(name.first(), Some(b'"' | b'\'')) && self.c.is_external_module_symbol(symbol) {
            return quoted(&self.specifier_of_module(symbol), b'"', true);
        }
        name
    }

    /// `getSymbolChain` without an enclosing declaration: only what is global is in scope.
    fn symbol_chain(
        &self,
        symbol: Sym,
        is_end_of_chain: bool,
        yields_module: bool,
        depth: u32,
    ) -> Option<Vec<Sym>> {
        let files = self.c.files();
        let is_module = self.c.is_external_module_symbol(symbol);
        let name = files.symbol(symbol).name;
        let is_global = name.is_some() && files.globals.get(&name) == Some(&symbol);
        if is_global && !is_module {
            return Some(vec![symbol]);
        }
        if depth < 32
            && let Some(parent) = files.parent_of_symbol(symbol)
            && let Some(mut chain) = self.symbol_chain(parent, false, yields_module, depth + 1)
        {
            chain.push(symbol);
            return Some(chain);
        }
        if !is_end_of_chain && !yields_module && is_module {
            return None;
        }
        Some(vec![symbol])
    }

    /// `lookupSymbolChain`
    fn lookup_symbol_chain(&self, symbol: Sym, yields_module: bool) -> Vec<Sym> {
        let is_type_parameter = self
            .c
            .files()
            .flags(symbol)
            .contains(SymFlags::TYPE_PARAMETER);
        if !is_type_parameter
            && self.flags & USE_FULLY_QUALIFIED_TYPE != 0
            && let Some(chain) = self.symbol_chain(symbol, true, yields_module, 0)
        {
            return chain;
        }
        vec![symbol]
    }

    /// `lookupSymbolChain` from `at`, which may be a block `enterNewScope` made up. Its locals only count if one of them has the name
    /// of `symbol`, or of what the chain starts with without them: `trySymbolTable` and `needsQualification` look up nothing else.
    fn lookup_symbol_chain_from(
        &mut self,
        symbol: Sym,
        is_value: bool,
        yields_module: bool,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let found = self
            .c
            .lookup_symbol_chain_at(symbol, is_value, yields_module, at, Vec::new());
        let first = if found.0 { None } else { found.1.first() };
        if at.fake_scope == 0
            || !self.is_name_of_fake_local(symbol)
                && !first.is_some_and(|&first| self.is_name_of_fake_local(first))
        {
            return found;
        }
        let files = self.c.files();
        let mut locals: Vec<(Atom, SymFlags, Option<Sym>)> = Vec::new();
        // The block of the type parameters is inside that of the parameters. In each a later entry hides an earlier one.
        for (name, parameter) in self.fake_scope_type_parameters.iter().rev() {
            let Some(name) = files.atoms.lookup(name) else {
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
            .lookup_symbol_chain_at(symbol, is_value, yields_module, at, locals)
    }

    fn is_name_of_fake_local(&self, symbol: Sym) -> bool {
        let files = self.c.files();
        let name = files.symbol(symbol).name;
        if name.is_none() {
            return false;
        }
        let text = files.atoms.bytes(name);
        let mut parameters = self.fake_scope_parameters.iter();
        let mut type_parameters = self.fake_scope_type_parameters.iter();
        parameters.any(|local| local.0 == name) || type_parameters.any(|local| local.0 == text)
    }

    /// `symbolToExpression(symbol, SymbolFlagsValue)`
    fn symbol_to_expression(&mut self, symbol: Sym) -> Vec<u8> {
        self.track_symbol(symbol, SymFlags::VALUE);
        let (starts_with_global_this, chain) = match self.enclosing_declaration {
            Some(at) => self.lookup_symbol_chain_from(symbol, true, false, at),
            None => (false, self.lookup_symbol_chain(symbol, false)),
        };
        // `createExpressionFromSymbolChain`
        let mut expression = if starts_with_global_this {
            b"globalThis".to_vec()
        } else {
            self.symbol_to_text(chain[0])
        };
        for &part in &chain[usize::from(!starts_with_global_this)..] {
            expression.push(b'.');
            expression.extend_from_slice(&self.export_name(part));
        }
        expression
    }

    /// `symbolToExpression(symbol, SymbolFlagsValue)` of the member `m` of a class or an interface, which has no `Sym`. `None`: it is
    /// a member of something else, or there is nowhere to look from.
    fn member_to_expression(&mut self, file: FileId, m: MemberId, name: Atom) -> Option<Vec<u8>> {
        let bound = self.c.bound(file);
        let container = match bound.member_owner[m.idx()] {
            MemberOwner::Class(class) => bound.class_symbol[class.idx()],
            MemberOwner::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => return None,
        };
        if container.is_none() {
            return None;
        }
        let container = self.c.files().sym(file, container);
        let at = self.enclosing_declaration?;
        let chain = self.c.lookup_symbol_chain_of_member_at(container, at);
        if chain.is_empty() {
            return None;
        }
        // `createExpressionFromSymbolChain`
        let mut expression = self.symbol_to_text(chain[0]);
        for &part in &chain[1..] {
            expression.push(b'.');
            expression.extend_from_slice(&self.export_name(part));
        }
        expression.push(b'.');
        expression.extend_from_slice(&self.text(name));
        Some(expression)
    }

    /// `symbolToTypeNode`. `is_type_of`: the meaning is `SymbolFlagsValue`.
    fn symbol_to_type_node(
        &mut self,
        symbol: Sym,
        is_type_of: bool,
        type_arguments: Vec<Node>,
    ) -> Node {
        self.track_symbol(
            symbol,
            if is_type_of {
                SymFlags::VALUE
            } else {
                SymFlags::TYPE
            },
        );
        let yields_module = self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0;
        let is_type_parameter = self
            .c
            .files()
            .flags(symbol)
            .contains(SymFlags::TYPE_PARAMETER);
        let (starts_with_global_this, chain) = match self.enclosing_declaration {
            Some(at) if !is_type_parameter => {
                self.lookup_symbol_chain_from(symbol, is_type_of, yields_module, at)
            }
            _ => (false, self.lookup_symbol_chain(symbol, yields_module)),
        };
        self.symbol_chain_to_type_node(
            symbol,
            starts_with_global_this,
            chain,
            is_type_of,
            type_arguments,
        )
    }

    /// `symbolToTypeNode`, with the meaning `SymbolFlagsValue`, of the symbol `cloneTypeAsModuleType` made of `module` for
    /// `originating_import`.
    fn module_clone_to_type_node(&mut self, module: Sym, originating_import: Sym) -> Node {
        let Some(at) = self.enclosing_declaration else {
            return self.symbol_to_type_node(module, true, Vec::new());
        };
        let clone = self.c.module_clone(originating_import);
        self.track_symbol(clone, SymFlags::VALUE);
        let yields_module = self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0;
        let (starts_with_global_this, chain) =
            self.c
                .lookup_symbol_chain_of_module_clone_at(originating_import, yields_module, at);
        self.symbol_chain_to_type_node(module, starts_with_global_this, chain, true, Vec::new())
    }

    /// `symbolToTypeNode`, from where it has the chain of `lookupSymbolChain`.
    fn symbol_chain_to_type_node(
        &mut self,
        symbol: Sym,
        starts_with_global_this: bool,
        chain: Vec<Sym>,
        is_type_of: bool,
        type_arguments: Vec<Node>,
    ) -> Node {
        let mut qualifier = Vec::new();
        for &part in &chain[usize::from(!starts_with_global_this)..] {
            let name = self.export_name(part);
            self.approximate_length += name.len() + 1;
            qualifier.push(b'.');
            qualifier.extend_from_slice(&name);
        }
        let type_arguments = type_arguments_text(type_arguments);
        let query: &[u8] = if is_type_of { b"typeof " } else { b"" };
        if !starts_with_global_this && self.c.is_external_module_symbol(chain[0]) {
            let (specifier, attributes) = self.import_type_specifier(chain[0]);
            if self.flags & ALLOW_NODE_MODULES_RELATIVE_PATHS == 0
                && attributes.is_empty()
                && bun_core::strings::contains(&specifier, b"/node_modules/")
            {
                self.encountered_error = true;
                let name = self.export_name(symbol);
                self.report(Report::LikelyUnsafeImportRequired(specifier.clone(), name));
            }
            self.approximate_length += specifier.len() + 10;
            return Node::simple(cat! {
                query, b"import(", quoted(&specifier, b'"', true), attributes, b")", qualifier,
                type_arguments
            });
        }
        let name = if starts_with_global_this {
            b"globalThis".to_vec()
        } else {
            self.name_of_symbol_as_written(chain[0], true)
        };
        self.approximate_length += 2 * (name.len() + 1);
        if is_type_of {
            return Node::new(cat!(b"typeof ", name, qualifier), TYPE_OPERATOR);
        }
        Node {
            text: cat!(name, qualifier, type_arguments),
            precedence: NON_ARRAY,
            reference: qualifier.is_empty().then_some(name),
            types: Vec::new(),
        }
    }

    /// `getSpecifierForModuleSymbol`, and the import attributes `symbolToTypeNode` writes after it.
    fn import_type_specifier(&mut self, module: Sym) -> (Vec<u8>, Vec<u8>) {
        if let Some(at) = self.enclosing_declaration {
            let allows_node_modules_relative_paths =
                self.flags & ALLOW_NODE_MODULES_RELATIVE_PATHS != 0;
            let (specifier, mode) = self.c.import_type_specifier_and_mode(
                module,
                at.file,
                allows_node_modules_relative_paths,
            );
            // Empty: `paths` or `rootDirs` have a say, which is not worked out.
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
        (self.specifier_of_module(module), Vec::new())
    }

    // ───────────────────────────── lists of types ─────────────────────────────

    /// `mapToTypeNodes`. Nothing for an empty list.
    fn map_to_type_nodes(&mut self, list: &[TypeId], is_bare_list: bool) -> Vec<Node> {
        if list.is_empty() {
            return Vec::new();
        }
        if self.check_truncation_length() {
            if !is_bare_list {
                return vec![self.elision()];
            }
            if list.len() > 2 {
                let first = self.type_to_node(list[0]);
                let last = self.type_to_node(list[list.len() - 1]);
                return vec![first, self.more_elided(list.len() - 2), last];
            }
        }
        let may_have_name_collisions = self.flags & USE_FULLY_QUALIFIED_TYPE == 0;
        let mut seen_names: Vec<(Vec<u8>, Vec<(TypeId, usize)>)> = Vec::new();
        let mut result: Vec<Node> = Vec::with_capacity(list.len());
        for (i, &ty) in list.iter().enumerate() {
            let display_index = i + 1;
            if self.check_truncation_length() && display_index + 2 < list.len() - 1 {
                result.push(self.more_elided(list.len() - display_index));
                result.push(self.type_to_node(list[list.len() - 1]));
                break;
            }
            self.approximate_length += 2;
            let node = self.type_to_node(ty);
            if may_have_name_collisions && let Some(name) = &node.reference {
                let entry = (ty, result.len());
                match seen_names.iter_mut().find(|seen| seen.0 == *name) {
                    Some(seen) => seen.1.push(entry),
                    None => seen_names.push((name.clone(), vec![entry])),
                }
            }
            result.push(node);
        }
        // Types of one name that are not one type are written again, with their qualified names.
        let saved_flags = self.flags;
        self.flags |= USE_FULLY_QUALIFIED_TYPE;
        for (_, types) in &seen_names {
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

    /// The symbol or the alias a type that is written as a name goes by.
    fn symbol_of_reference(&mut self, ty: TypeId) -> Option<Sym> {
        if let Some((alias, _)) = self.c.alias_of_type(ty) {
            return Some(alias);
        }
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => Some(*target),
            TypeData::Union(members) => self.enum_of_members(ty, members),
            TypeData::EnumLit { member, .. } => self.c.files().parent_of_symbol(*member),
            TypeData::Enum { symbol, .. } => Some(*symbol),
            _ => None,
        }
    }

    /// `typesAreSameReference`
    fn are_same_reference(&mut self, a: TypeId, b: TypeId) -> bool {
        if a == b {
            return true;
        }
        if let (TypeData::TypeParam(f, t, _), TypeData::TypeParam(g, u, _)) =
            (self.c.data(a), self.c.data(b))
        {
            return (f, t) == (g, u);
        }
        match (self.symbol_of_reference(a), self.symbol_of_reference(b)) {
            (Some(x), Some(y)) => x == y,
            _ => false,
        }
    }

    // ───────────────────────────── references ─────────────────────────────

    /// `getParentSymbolOfTypeParameter`: the scope that declares it stands for the symbol.
    fn container_of_type_parameter(&self, parameter: TypeId) -> Option<(FileId, ScopeId)> {
        match *self.c.data(parameter) {
            TypeData::TypeParam(file, tp, _) => {
                Some((file, self.c.bound(file).type_param_scope[tp.idx()]))
            }
            _ => None,
        }
    }

    fn name_of_container(&mut self, container: Option<(FileId, ScopeId)>) -> Vec<u8> {
        let Some((file, scope)) = container.filter(|container| container.1.is_some()) else {
            return Vec::new();
        };
        let bound = self.c.bound(file);
        let symbol = match bound.scopes[scope.idx()].kind {
            ScopeKind::Fn(function) => {
                if let FnOwner::Member(member) = bound.fns[function.idx()].owner {
                    let owner = bound.member_owner[member.idx()];
                    let member = &self.c.hir(file)[member];
                    let name = self.declaration_name_to_string(file, member.key, member.name_pos);
                    // `getSymbolChain`: a method is reached through its class.
                    if self.enclosing_declaration.is_some()
                        && let MemberOwner::Class(class) = owner
                        && bound.class_symbol[class.idx()].is_some()
                    {
                        let class = self.c.files().sym(file, bound.class_symbol[class.idx()]);
                        let class = self.symbol_to_type_node(class, false, Vec::new());
                        return cat!(class.text, b".", name);
                    }
                    return name;
                }
                // `GetAssignedName`
                if self.c.hir(file)[function].name.is_none()
                    && let FnOwner::Expr(e) = bound.fns[function.idx()].owner
                {
                    return self
                        .name_of_initialized_variable(file, e)
                        .unwrap_or_else(|| b"(Anonymous function)".to_vec());
                }
                bound.fn_symbol[function.idx()]
            }
            ScopeKind::Class(class) => bound.class_symbol[class.idx()],
            ScopeKind::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => SymbolId::NONE,
        };
        if symbol.is_none() {
            return b"(Anonymous function)".to_vec();
        }
        self.name_of_symbol_as_written(self.c.files().sym(file, symbol), true)
    }

    /// `typeReferenceToTypeNode`, of a reference to a class or an interface.
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
        // The groups of type arguments for the type parameters of what the declaration is inside of. `appendReferenceToType` keeps
        // the names and drops the type arguments of all but the last reference.
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
                let name = self.name_of_container(container);
                if !name.is_empty() {
                    self.approximate_length += 2 * (name.len() + 1);
                    qualifier.extend_from_slice(&name);
                    qualifier.push(b'.');
                }
            }
        }
        let mut arguments = Vec::new();
        if !args.is_empty() {
            let mut count = all.len().min(args.len());
            // Those of iterables that are what they default to are left out.
            let is_iterable = [
                known::Iterable,
                known::IterableIterator,
                known::AsyncIterable,
                known::AsyncIterableIterator,
            ]
            .into_iter()
            .any(|name| self.c.global_type_symbol(name) == Some(target));
            while is_iterable && count > 0 {
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
        let mut node = self.symbol_to_type_node(target, false, arguments);
        if !qualifier.is_empty() {
            node.text.splice(0..0, qualifier);
            node.reference = None;
        }
        node
    }

    /// `typeReferenceToTypeNode`, of a tuple.
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

    fn name_of_type_parameter(&self, parameter: TypeId) -> Vec<u8> {
        match self.c.type_param_name(parameter) {
            Some(name) if name.is_some() => self.text(name),
            _ => b"?".to_vec(),
        }
    }

    /// `typeParameter.symbol`, to compare. The type parameters of the declarations of one class or interface are one symbol, name for
    /// name. One that `getUniqueTypeParameters` renamed has a symbol of its own.
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

    /// `newTypeParameter(newSymbol(SymbolFlagsTypeParameter, "T"))`: another each time, as long as each is named before the next is made.
    fn new_type_parameter(&self, like: TypeId) -> Option<TypeId> {
        let name = self.c.files().atoms.intern(b"T");
        self.c
            .renamed_type_param(like, name, self.type_parameter_names.len())
    }

    /// `typeParameterToName`
    fn type_parameter_to_name(&mut self, parameter: TypeId) -> Vec<u8> {
        let raw = self.name_of_type_parameter(parameter);
        if self.flags & GENERATE_NAMES_FOR_SHADOWED_TYPE_PARAMS == 0 {
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

    /// `enterNewScope`. What it returns is for `leave_scope`.
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
            fake_scope_type_parameters: self.fake_scope_type_parameters.len(),
            fake_scope_parameters: self.fake_scope_parameters.len(),
            enclosing_declaration: self.enclosing_declaration,
            has_fake_scope: self.has_fake_scope,
            mapper: self.mapper,
        };
        // `pushFakeScope("params", ..)`, which lies around that of the type parameters.
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
                    self.fake_scope_parameters
                        .push((name, (!is_instantiated).then_some(symbol)));
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

    /// `pushFakeScope`, where it makes a block. One of a kind that is there is used again by what is written inside of it.
    fn push_fake_scope(&mut self, kind: usize) {
        if let Some(enclosing_declaration) = &mut self.enclosing_declaration
            && !self.has_fake_scope[kind]
        {
            self.has_fake_scope[kind] = true;
            self.fake_scope_count += 1;
            enclosing_declaration.fake_scope = self.fake_scope_count;
        }
    }

    fn leave_scope(&mut self, outer: OuterScope) {
        self.type_parameter_names
            .truncate(outer.type_parameter_names);
        self.type_parameter_name_counts
            .truncate(outer.type_parameter_name_counts);
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
            self.approximate_length += 2 * (name.len() + 1);
            return Node {
                text: name.clone(),
                precedence: NON_ARRAY,
                reference: Some(name),
                types: Vec::new(),
            };
        }
        self.approximate_length += name.len() + 6;
        // A constraint that follows from where `infer T` is written is left out.
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
                    cat!(b"infer ", name, b" extends ", constraint.text),
                    FUNCTION,
                );
            }
        }
        Node::new(cat!(b"infer ", name), TYPE_OPERATOR)
    }

    /// The constraint of `parameter` in its declaration. `typeToTypeNodeHelperWithPossibleReusableTypeNode`: it is written as it is
    /// declared if that still is what it comes to.
    /// `clones`: type parameters that stand for clones of themselves (`has_inference_context`).
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
        // `getConstraintOfTypeParameter`. `constraint_of_type_param` is asked by `computeBaseConstraint` itself here, and sees a circle
        // only as far as type parameters, unions and intersections lead.
        let constraint = match self.c.constraint_of_type_param(parameter) {
            Some(constraint) if self.c.has_non_circular_base_constraint(parameter) => {
                Some(self.constraint_to_node(parameter, constraint, clones).text)
            }
            _ => None,
        };
        let mut text = Vec::new();
        if let Some((_, declaration)) = self.c.type_param_decl(parameter) {
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
        text
    }

    // ───────────────────────────── unions and intersections ─────────────────────────────

    fn union_to_node(&mut self, ty: TypeId) -> Node {
        // `UnionType.origin` is written in its place.
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

    /// `formatUnionTypes`, of the members of `ty` in the order TypeScript keeps them in.
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
            // All the members of `boolean` or of an enum, which are next to each other, are written as one.
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

    /// `isNonLocalFunctionSymbol`, of a declared function.
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

    /// `shouldEmitTypeOfSymbol`: the symbol `typeof` names the type `ty` of `origin` by.
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

    /// `shouldEmitTypeOfSymbol`, up to where it asks `shouldWriteTypeOfFunctionSymbol`. `meaning`: `isInstanceType`.
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
        is_class_declaration
            && match self.enclosing_declaration {
                Some(at) => self.c.is_symbol_accessible_at(symbol, meaning, false, at),
                None => true,
            }
    }

    /// The same for a function expression that initializes a variable at the top of a file or a namespace: the variable. If that is
    /// the enclosing declaration, the function expression itself.
    fn variable_of_function_expression(&self, ty: TypeId) -> Option<Sym> {
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
        if statement.is_none()
            || !matches!(
                bound.stmt_parent[statement.idx()],
                Parent::File | Parent::Module(_)
            )
        {
            return None;
        }
        // `symbol.ValueDeclaration.Parent != b.ctx.enclosingDeclaration`. One without a name goes by that of the variable anyway.
        let own = bound.fn_symbol[func.idx()];
        let symbol = if own.is_some()
            && self
                .enclosing_declaration
                .is_some_and(|at| (at.file, at.variable) == (file, declaration))
        {
            own
        } else {
            bound.pat_symbol[hir[declaration].pat.idx()]
        };
        symbol.is_some().then(|| self.c.files().sym(file, symbol))
    }

    /// `isStaticMethodSymbol`: the name of the static method `ty` is the type of.
    fn name_of_static_method(&self, ty: TypeId) -> Option<Vec<u8>> {
        let TypeData::Fns { decls, .. } = self.c.data(ty) else {
            return None;
        };
        decls.iter().find_map(|&(file, func)| {
            let FnOwner::Member(member) = self.c.bound(file).fns[func.idx()].owner else {
                return None;
            };
            let member = &self.c.hir(file)[member];
            if member.kind != MemberKind::Method || !member.flags.contains(Flags::STATIC) {
                return None;
            }
            member.key.name().map(|name| self.text(name))
        })
    }

    /// `symbol.Parent` of the method `ty` is the type of.
    fn class_of_method(&self, ty: TypeId) -> Option<Sym> {
        let TypeData::Fns { decls, .. } = self.c.data(ty) else {
            return None;
        };
        decls.iter().find_map(|&(file, func)| {
            let bound = self.c.bound(file);
            let FnOwner::Member(member) = bound.fns[func.idx()].owner else {
                return None;
            };
            let MemberOwner::Class(class) = bound.member_owner[member.idx()] else {
                return None;
            };
            let symbol = bound.class_symbol[class.idx()];
            symbol.is_some().then(|| self.c.files().sym(file, symbol))
        })
    }

    /// `createAnonymousTypeNode`
    fn anonymous_type_to_node(&mut self, ty: TypeId) -> Node {
        // `createAnonymousTypeNodeEx`: "Anonymous types without a symbol are never circular."
        if matches!(self.c.data(ty), TypeData::ReverseMapped { .. }) {
            return self.object_type_to_node(ty);
        }
        // An `InstantiationExpressionType` that is the type of its type query is written as that query.
        if let TypeData::Synth(shape) = self.c.data(ty)
            && let Some(InstantiationExpression::TypeNode(file, node)) =
                shape.instantiation_expression
            && matches!(self.c.hir(file)[node].kind, TypeNodeKind::Typeof { .. })
        {
            let declared = self.c.type_from_node(file, node);
            if self.c.instantiate(declared, self.mapper) == ty {
                // A query whose name cannot be used here is written from its type, which comes back to this place.
                if self.visited_types.contains(&ty) {
                    return self.elided_information_placeholder();
                }
                self.visited_types.push(ty);
                let reused = self.reuse_type_node(file, node);
                self.visited_types.retain(|&visited| visited != ty);
                return reused;
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
                        Origin::WidenedLiteral(file, literal, false, false)
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
        // `shouldWriteTypeOfFunctionSymbol`, of a static method and of a function expression.
        if self.flags & USE_TYPE_OF_FUNCTION != 0 || self.visited_types.contains(&ty) {
            let has_structural_fallback = self.flags & USE_STRUCTURAL_FALLBACK != 0;
            // `getSymbolChain`: a method is reached through its class.
            if self.enclosing_declaration.is_some()
                && let Some(name) = self.name_of_static_method(ty)
                && let Some(class) = self.class_of_method(ty)
                && (!has_structural_fallback || self.is_value_symbol_accessible(class))
            {
                let class = self.symbol_to_type_node(class, true, Vec::new());
                return Node::new(cat!(class.text, b".", name), TYPE_OPERATOR);
            }
            if let Some(variable) = self.variable_of_function_expression(ty)
                && (!has_structural_fallback || self.is_value_symbol_accessible(variable))
            {
                return self.symbol_to_type_node(variable, true, Vec::new());
            }
            if !has_structural_fallback && let Some(name) = self.name_of_static_method(ty) {
                self.approximate_length += 2 * (name.len() + 1);
                return Node::new(cat!(b"typeof ", name), TYPE_OPERATOR);
            }
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
        if self.c.mapped_origin(ty).is_some()
            && (self.c.is_generic(ty) || self.c.p.mapped_types_with_errors.get(&ty).is_some())
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
        let properties = self.ordered_properties(&shape.props);
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
        // `abstract new () => T` cannot be written in a type literal: it is intersected with the rest.
        let mut nodes = Vec::with_capacity(abstract_signatures.len() + 1);
        for signature in abstract_signatures {
            self.approximate_length += 2;
            nodes.push(self.signature_to_node(signature, SignatureKind::ConstructorType));
        }
        let property_count = if self.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL != 0 {
            properties
                .iter()
                .filter(|property| !self.is_prototype_property(ty, property))
                .count()
        } else {
            properties.len()
        };
        if call.len() + construct.len() + shape.index.len() + property_count != 0 {
            self.approximate_length += 2;
            nodes.push(self.type_literal_to_node(
                ty,
                &call,
                &construct,
                &shape.index,
                &properties,
                mapper,
            ));
        }
        if nodes.len() == 1
            && let Some(only) = nodes.pop()
        {
            return only;
        }
        Node::new(join_nodes(nodes, b" & ", TYPE_OPERATOR), INTERSECTION)
    }

    /// `propertySymbol.Flags&SymbolFlagsPrototype != 0`, of a property of `owner`.
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
        let elements = self.type_elements(ty, call, construct, index, properties, mapper);
        self.flags = saved_flags;
        self.approximate_length += 2;
        if elements.is_empty() {
            Node::simple(b"{}")
        } else {
            Node::simple(cat!(b"{ ", elements.join(&b" "[..]), b" }"))
        }
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
            // `NewNotEmittedTypeElement`: one element, which is written as nothing.
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
            // The placeholder is made whether or not it is used.
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

    /// `indexInfoToObjectComputedNamesOrSignatureDeclaration`: the property signatures written for `info.components`. `None`: the
    /// index signature is written instead (`indexInfoToIndexSignatureDeclarationHelper`). `type_node`: what is written for the
    /// type of each, if not its own type.
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
        for (component, file, name) in names {
            // `hasLateBindableName`
            if self.c.member_name(file, PropKey::Computed(name)).is_some() {
                continue;
            }
            let name = self.reuse_computed_property_name(file, name)?;
            // `e.PostfixToken()`
            let postfix_token: &[u8] = match component {
                IndexComponent::Property(file, p) if self.c.is_optional_method(file, p) => b"?",
                IndexComponent::Property(..) => b"",
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
        Some(results)
    }

    // ───────────────────────────── properties ─────────────────────────────

    /// The property `name` of `ty`, for its declarations. `resolveReverseMappedTypeMembers`: a property of a reverse mapped type has those
    /// of the property of the source it is inferred from.
    fn property_with_declarations(&mut self, ty: TypeId, name: Atom) -> Option<Prop> {
        let mut of = ty;
        while let TypeData::ReverseMapped { source, .. } = *self.c.data(of) {
            of = source;
        }
        self.c.prop_of(of, name).map(|found| found.0)
    }

    fn place_of_symbol(&self, symbol: Sym) -> Place {
        let files = self.c.files();
        let Some((file, decl)) = files.decls(symbol).first().copied() else {
            return Place::Nowhere;
        };
        let pos = self.c.files().start_of_declaration(file, decl);
        Place::At(self.c.place_in_program_order(file, pos))
    }

    /// Where the first declaration of `prop` is.
    fn place_of_property(&mut self, prop: &Prop, depth: u32) -> Place {
        let at = |c: &Checker<'p>, file: FileId, pos: u32| {
            Place::At(c.place_in_program_order(file, pos))
        };
        match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, member)) => at(&*self.c, file, self.c.hir(file)[member].name_pos),
                None => Place::Nowhere,
            },
            PropSource::Parameter(file, parameter) => {
                at(&*self.c, *file, self.c.hir(*file)[*parameter].pos)
            }
            PropSource::Literal(file, written) => {
                let hir = self.c.hir(*file);
                // The nodes of a JSON file have no positions. Its properties are numbered in source order.
                let pos = if hir.kind == FileKind::Json {
                    written.0
                } else {
                    hir[*written].pos
                };
                at(&*self.c, *file, pos)
            }
            PropSource::Symbol(symbol) => self.place_of_symbol(*symbol),
            PropSource::Assigned(file, list) => match list.first() {
                Some(&first) => at(&*self.c, *file, self.c.hir(*file)[first].pos),
                None => Place::Nowhere,
            },
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts)
                if depth < 8 =>
            {
                match parts.first() {
                    Some(first) => self.place_of_property(first, depth + 1),
                    None => Place::Nowhere,
                }
            }
            PropSource::Mapped(..) if depth < 8 => {
                match prop.declared_by_modifiers_property().first() {
                    Some(first) => self.place_of_property(first, depth + 1),
                    None => Place::Nowhere,
                }
            }
            _ => Place::Nowhere,
        }
    }

    /// `getNamedMembers` sorts with `compareSymbols`: by where the first declaration is, and what has none last, by name.
    fn ordered_properties(&mut self, props: &[Prop]) -> Vec<Prop> {
        let mut keyed: Vec<((u8, (bool, u32, u32), &'p [u8]), &Prop)> =
            Vec::with_capacity(props.len());
        for prop in props {
            let name = self.c.files().atoms.bytes(prop.name);
            let place = match &prop.source {
                PropSource::Literal(file, written) => {
                    let pos = self
                        .c
                        .first_declaration_pos_of_literal_property(*file, *written);
                    Place::At(self.c.place_in_program_order(*file, pos))
                }
                _ => self.place_of_property(prop, 0),
            };
            keyed.push(match place {
                Place::At(place) => ((0, place, name), prop),
                Place::Nowhere => ((1, (false, 0, 0), name), prop),
            });
        }
        keyed.sort_by(|a, b| a.0.cmp(&b.0));
        keyed.into_iter().map(|entry| entry.1.clone()).collect()
    }

    /// How the declaration `written` of a property of an object literal writes its name.
    fn written_name_of_literal_property(&mut self, file: FileId, written: PropId) -> WrittenName {
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
        WrittenName {
            is_string,
            is_single_quoted: first == Some(b'\''),
            is_computed: in_brackets || matches!(written.key, PropKey::Computed(_)),
        }
    }

    /// How the declarations of `prop` write its name.
    fn written_names(&mut self, prop: &Prop, depth: u32, out: &mut Vec<WrittenName>) {
        let plain = WrittenName {
            is_string: false,
            is_single_quoted: false,
            is_computed: false,
        };
        match &prop.source {
            PropSource::Members(list) => {
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
                    out.push(WrittenName {
                        is_string,
                        is_single_quoted: hir.text.get(member.name_pos as usize) == Some(&b'\''),
                        is_computed,
                    });
                }
            }
            PropSource::Literal(file, written) => {
                for declaration in self.c.bound(*file).declarations_of_literal_member(*written) {
                    let name = self.written_name_of_literal_property(*file, declaration);
                    out.push(name);
                }
            }
            PropSource::Parameter(..) | PropSource::Symbol(_) => out.push(plain),
            PropSource::Assigned(file, list) => {
                let hir = self.c.hir(*file);
                for &declaration in list.iter() {
                    let is_string = match hir[declaration].kind {
                        ExprKind::Assign { target, .. } => match hir[target].kind {
                            ExprKind::Index { index, .. } => {
                                let key = self.c.type_of_expr(*file, index);
                                self.c.is_string_like(key)
                            }
                            _ => false,
                        },
                        _ => false,
                    };
                    out.push(WrittenName { is_string, ..plain });
                }
            }
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts)
                if depth < 8 =>
            {
                for part in parts.iter() {
                    self.written_names(part, depth + 1, out);
                }
            }
            PropSource::Mapped(..) if depth < 8 => {
                for part in prop.declared_by_modifiers_property() {
                    self.written_names(part, depth + 1, out);
                }
            }
            _ => {}
        }
    }

    /// The expression in the brackets of the first declaration of `prop`, if it is written `a` or `a.b.c`.
    fn computed_key_text(&mut self, prop: &Prop, depth: u32) -> Option<Vec<u8>> {
        let (file, key) = match &prop.source {
            PropSource::Members(list) => {
                let &(file, member) = list.first()?;
                (file, self.c.hir(file)[member].key)
            }
            PropSource::Literal(file, written) => (*file, self.c.hir(*file)[*written].key),
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts)
                if depth < 8 =>
            {
                return self.computed_key_text(parts.first()?, depth + 1);
            }
            PropSource::Mapped(..) if depth < 8 => {
                let first = prop.declared_by_modifiers_property().first()?;
                return self.computed_key_text(first, depth + 1);
            }
            _ => return None,
        };
        match key {
            PropKey::Computed(e) => self.entity_name_text(file, e),
            _ => None,
        }
    }

    /// `getPropertyNameNodeForSymbol`
    fn property_name(&mut self, prop: &Prop) -> Vec<u8> {
        let bytes = self.c.files().atoms.bytes(prop.name);
        if bytes.first() == Some(&b'#') {
            return self.c.written_name(prop.name).to_vec();
        }
        // `getPropertyNameNodeForSymbolFromNameType`: the `nameType` is a `unique symbol`.
        if bytes.starts_with(crate::atom::SYMBOL_NAME_PREFIX)
            && let Some(name_type) = self.c.key_type_of_name(prop.name)
            && let TypeData::UniqueSymbol { symbol, name } = *self.c.data(name_type)
        {
            let outer = self.enclosing_declaration;
            if let Some(own) = self.enclosing_declaration_of_property_name(prop) {
                self.enclosing_declaration = Some(own);
            }
            let expression = match symbol {
                UniqueSymbolDeclaration::Variable(variable) => self.symbol_to_expression(variable),
                UniqueSymbolDeclaration::Member(file, m) => self
                    .member_to_expression(file, m, name)
                    .or_else(|| self.computed_key_text(prop, 0))
                    .unwrap_or_else(|| self.text(name)),
                UniqueSymbolDeclaration::SymbolConstructor => {
                    match self.computed_key_text(prop, 0) {
                        Some(written) => written,
                        None => cat!(b"Symbol.", self.text(name)),
                    }
                }
            };
            self.enclosing_declaration = outer;
            self.approximate_length += expression.len() + 1;
            return cat!(b"[", expression, b"]");
        }
        let name = bytes.to_vec();
        let mut written = Vec::new();
        self.written_names(prop, 0, &mut written);
        let is_string_named = !written.is_empty() && written.iter().all(|w| w.is_string);
        let quote = if !written.is_empty() && written.iter().all(|w| w.is_single_quoted) {
            b'\''
        } else {
            b'"'
        };
        // `links.nameType`. `checkObjectLiteral` takes it from the member the property is made of, whatever else declares the name, and
        // `createSymbolWithType` passes it on.
        let made_of = match &prop.source {
            PropSource::Copy(_, parts, _) => parts.first().unwrap_or(prop),
            _ => prop,
        };
        let has_name_type = matches!(prop.source, PropSource::Mapped(..))
            || match &made_of.source {
                PropSource::Literal(file, member) => {
                    self.written_name_of_literal_property(*file, *member)
                        .is_computed
                }
                _ => written.first().is_some_and(|w| w.is_computed),
            };
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
        quoted(&name, quote, true)
    }

    /// `getNameOfSymbolFromNameType`, going by the name alone.
    fn name_from_name_type(&self, name: Atom) -> Vec<u8> {
        let bytes = self.c.files().atoms.bytes(name);
        if bytes.first() == Some(&b'#') {
            return self.c.written_name(name).to_vec();
        }
        if let Some(symbol) = bytes.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) {
            let end = symbol
                .iter()
                .position(|&b| b == b'@')
                .unwrap_or(symbol.len());
            return cat!(b"[", symbol[..end], b"]");
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

    /// `getNameOfSymbolAsWritten`, of a property: its name as its first declaration writes it.
    fn name_of_property_as_written(&mut self, prop: &Prop, depth: u32) -> Vec<u8> {
        match &prop.source {
            PropSource::Members(list) => {
                if let Some(&(file, member)) = list.first() {
                    let member = &self.c.hir(file)[member];
                    return self.declaration_name_to_string(file, member.key, member.name_pos);
                }
            }
            PropSource::Parameter(file, parameter) => {
                let hir = self.c.hir(*file);
                let pos = hir[hir[*parameter].pat].pos;
                return self.declaration_name_to_string(*file, PropKey::Name(prop.name), pos);
            }
            PropSource::Literal(file, property) => {
                let written = &self.c.hir(*file)[*property];
                let end = self.c.end_of_prop_name(*file, *property);
                // `GetTextOfNode(name)`: a computed name ends where the parser left it, be the `]` missing.
                if matches!(written.key, PropKey::Computed(_)) {
                    return self.c.source_text(*file, written.pos, end).into_bytes();
                }
                // The name of a JSX attribute is more than a token: `data-\u0061`.
                return self
                    .text_of_name(*file, written.pos, end)
                    .unwrap_or_else(|| self.property_key_text(*file, written.key, written.pos));
            }
            PropSource::Symbol(symbol) => return self.symbol_to_text(*symbol),
            PropSource::Assigned(file, list) => {
                if let Some(&first) = list.first()
                    && let Some(text) = self.c.name_of_assignment_declaration(*file, first)
                {
                    return text.into_bytes();
                }
            }
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts)
                if depth < 8 =>
            {
                if let Some(first) = parts.first() {
                    return self.name_of_property_as_written(first, depth + 1);
                }
            }
            PropSource::Mapped(..) if depth < 8 => {
                if let Some(first) = prop.declared_by_modifiers_property().first() {
                    return self.name_of_property_as_written(first, depth + 1);
                }
            }
            _ => {}
        }
        self.name_from_name_type(prop.name)
    }

    /// `ObjectFlagsAnonymous`
    fn is_anonymous_object_type(&self, ty: TypeId) -> bool {
        match self.c.data(ty) {
            TypeData::Anon { origin, .. } => !matches!(origin, Origin::Mapped(..)),
            TypeData::Fns { .. } | TypeData::Synth(_) => true,
            _ => false,
        }
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
            && !self.is_anonymous_object_type(last.property_type)
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
        match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, member)) => (
                    matches!(
                        self.c.bound(file).member_owner[member.idx()],
                        MemberOwner::Class(_)
                    ),
                    self.c.hir(file)[member].kind == MemberKind::Property,
                ),
                None => (false, false),
            },
            _ => (false, false),
        }
    }

    /// The name of the parameter of the setter of `prop`.
    fn name_of_setter_parameter(&mut self, prop: &Prop) -> Vec<u8> {
        let mut setter: Option<(FileId, FnId)> = None;
        match &prop.source {
            PropSource::Members(list) => {
                setter = list
                    .iter()
                    .find(|&&(file, member)| self.c.hir(file)[member].kind == MemberKind::Setter)
                    .map(|&(file, member)| (file, self.c.hir(file)[member].func));
            }
            PropSource::Literal(file, written) => {
                let (file, hir) = (*file, self.c.hir(*file));
                let owner = self.c.bound(file).prop_owner[written.idx()];
                if owner.is_some()
                    && let ExprKind::Object(props) = hir[owner].kind
                {
                    for p in props.iter() {
                        if hir[p].kind == PropKind::Setter
                            && self.c.member_name(file, hir[p].key) == Some(prop.name)
                            && let ExprKind::Fn(func) = hir[hir[p].value].kind
                        {
                            setter = Some((file, func));
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
        if let Some((file, func)) = setter
            && func.is_some()
            && let Some(parameter) = self.c.hir(file)[func].params.iter().next()
        {
            return self.binding_name_text(file, self.c.hir(file)[parameter].pat);
        }
        b"value".to_vec()
    }

    /// The start of `addPropertyToElementList`, of a property that a `unique symbol` names.
    fn track_late_bound_name(&mut self, prop: &Prop, depth: u32) {
        let (file, key) = match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, m)) => (file, self.c.hir(file)[m].key),
                None => return,
            },
            PropSource::Literal(file, p) => (*file, self.c.hir(*file)[*p].key),
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts) => {
                if let Some(first) = parts.first()
                    && depth < 8
                {
                    self.track_late_bound_name(first, depth + 1);
                }
                return;
            }
            PropSource::Mapped(..) => {
                match prop.declared_by_modifiers_property().first() {
                    Some(first) if depth < 8 => self.track_late_bound_name(first, depth + 1),
                    Some(_) => {}
                    // It has no declaration.
                    None => {
                        let mut name = Vec::new();
                        self.c.write_prop(&mut name, prop);
                        self.report(Report::NonSerializableProperty(name));
                    }
                }
                return;
            }
            // It has no declaration.
            PropSource::Type(_) => {
                let mut name = Vec::new();
                self.c.write_prop(&mut name, prop);
                return self.report(Report::NonSerializableProperty(name));
            }
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
        // A name that means nothing where the type is written is tracked as what it means where it is written, which should be
        // inaccessible.
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
        // `isReadonlySymbol`
        let is_readonly = prop.flags.contains(PropFlags::READONLY)
            || self.c.has_readonly_assignment_declaration(prop);
        // `getNonMissingTypeOfSymbol`
        let property_type = if uses_placeholder {
            TypeId::ANY
        } else {
            let ty = self.c.type_of_prop(prop, mapper);
            self.c.remove_missing_type(ty, is_optional)
        };
        // `isLateBoundName`
        if self.c.files().atoms.is_symbol_name(prop.name) {
            self.track_late_bound_name(prop, 0);
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
        self.approximate_length += self.c.written_name(prop.name).len() + 1;
        if prop.flags.contains(PropFlags::ACCESSOR) && self.c.is_known(property_type) {
            let write_type = self.c.write_type_of_prop(prop, mapper);
            let (in_class, is_field) = self.accessor_declaration(prop);
            if self.c.is_known(write_type)
                && !self.c.is_error_type(property_type)
                && !self.c.is_error_type(write_type)
                && (property_type != write_type || in_class)
            {
                if is_field || !prop.flags.contains(PropFlags::WRITE_ONLY) {
                    self.approximate_length += 3;
                    let node =
                        self.serialize_type_of_accessor(prop, MemberKind::Getter, property_type);
                    elements.push(cat!(b"get ", name, b"(): ", node.text, b";"));
                }
                if is_field || !is_readonly {
                    self.approximate_length += 3;
                    let parameter = if is_field {
                        b"arg".to_vec()
                    } else {
                        self.name_of_setter_parameter(prop)
                    };
                    let node =
                        self.serialize_type_of_accessor(prop, MemberKind::Setter, write_type);
                    self.approximate_length += parameter.len() + 3;
                    elements.push(cat! { b"set ", name, b"(", parameter, b": ", node.text, b");" });
                }
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
                    elements.push(cat!(text, b";"));
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
        elements.push(cat!(modifier, name, question, b": ", node.text, b";"));
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// `cloneBindingName`: a name or a pattern as it is written, on one line and without initializers.
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
                        cat! { self.property_key_text(file, prop.key, prop.pos), b": ", value }
                    });
                }
                let last = props.iter().next_back();
                let comma = last.map_or(&b""[..], |last| {
                    self.trailing_comma_after(file, self.c.end_of_pat_prop(file, last))
                });
                if parts.is_empty() {
                    b"{}".to_vec()
                } else {
                    cat!(b"{ ", parts.join(&b", "[..]), comma, b" }")
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
                let last = elems.iter().next_back();
                let comma = last.map_or(&b""[..], |last| {
                    self.trailing_comma_after(file, self.c.end_of_pat_elem(file, last))
                });
                cat!(b"[", parts.join(&b", "[..]), comma, b"]")
            }
        }
    }

    /// `NodeList.HasTrailingComma`: the comma, if one follows the last element of a list, which ends at `end`.
    fn trailing_comma_after(&self, file: FileId, end: u32) -> &'static [u8] {
        let next = self.c.skip_trivia_from(file, end);
        match self.c.hir(file).text.get(next as usize) {
            Some(b',') => b",",
            _ => b"",
        }
    }

    /// `signature.parameters`, with what `symbolToParameterDeclaration` finds out about each.
    fn signature_parameters(&mut self, signature: SigId) -> Vec<Parameter> {
        let (file, func, mapper) = match self.c.p.types.sig(signature) {
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
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let parameters = hir[func].params;
        // `getImmediatelyInvokedFunctionExpression`: the arguments a function called where it is written is called with.
        let arguments = bound
            .get_immediately_invoked_function_expression(hir, func)
            .map(|call| hir[call].args);
        let given = arguments.map(|arguments| arguments.len());
        // `getEffectiveCallArguments`: a tuple that is spread counts for its elements.
        let effective = arguments.map(|arguments| {
            let mut count = 0usize;
            for argument in hir.ids(arguments) {
                self.c.each_effective_arg(file, argument, |_| count += 1);
            }
            count
        });
        let is_left_out = |i: usize, parameter: &Param| {
            given.is_some_and(|given| i >= given)
                && parameter.ty.is_none()
                && !parameter.flags.contains(Flags::REST)
        };
        let mut types = Vec::with_capacity(parameters.len());
        // `getMinArgumentCountEx(signature, MinArgumentCountFlagsVoidIsNonOptional)`
        let mut minimum = 0;
        for (i, p) in parameters.iter().enumerate() {
            let parameter = &hir[p];
            let declared = self.c.type_of_param(file, p);
            types.push(self.c.instantiate(declared, mapper));
            if !parameter.flags.intersects(Flags::OPTIONAL | Flags::REST)
                && parameter.default.is_none()
                && !is_left_out(i, parameter)
            {
                minimum = i + 1;
            }
        }
        if let Some(last) = parameters.iter().next_back()
            && hir[last].flags.contains(Flags::REST)
            && let TypeData::Tuple { flags, .. } = self.c.data(types[types.len() - 1])
        {
            let required = flags
                .iter()
                .position(|flag| !flag.contains(ElemFlags::REQUIRED))
                .unwrap_or(flags.len());
            if required > 0 {
                minimum = parameters.len() - 1 + required;
            }
        }
        let strict = self.c.p.files.options.strict_null_checks;
        let mut list = Vec::with_capacity(parameters.len());
        for (i, p) in parameters.iter().enumerate() {
            let parameter = &hir[p];
            // `isOptionalParameter`
            let optional = parameter.flags.contains(Flags::OPTIONAL)
                || if parameter.default.is_some() {
                    i >= minimum
                } else {
                    effective.is_some_and(|effective| i >= effective)
                        && parameter.ty.is_none()
                        && !parameter.flags.contains(Flags::REST)
                };
            let mut ty = types[i];
            // `requiresAddingImplicitUndefined`: one with an initializer that cannot be left out can be given `undefined`.
            if strict
                && !optional
                && parameter.default.is_some()
                && !parameter.flags.contains(Flags::PARAMETER_PROPERTY)
            {
                let written = self.c.type_from_node(file, parameter.ty);
                // `declaredParameterTypeContainsUndefined`
                let says_undefined = parameter.ty.is_some()
                    && (!self.c.is_known(written)
                        || self.c.is_error_type(written)
                        || self.c.contains_undefined(written));
                if !says_undefined {
                    ty = self.c.optional(ty);
                }
            }
            let name = self.binding_name_text(file, parameter.pat);
            let name_length = match hir[parameter.pat].kind {
                PatKind::Ident(_) => name.len(),
                // A pattern is bound as `__0`.
                _ => 2 + digit_count(i),
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

    /// `getTupleElementLabelFromBindingElement`
    fn label_from_binding_element(
        &self,
        file: FileId,
        pat: PatId,
        has_dot_dot_dot: bool,
        index: usize,
        flags: ElemFlags,
    ) -> Vec<u8> {
        let hir = self.c.hir(file);
        let is_variable = flags.intersects(ElemFlags::REST | ElemFlags::VARIADIC);
        match hir[pat].kind {
            PatKind::Ident(name) => {
                let name = self.text(name);
                return match (has_dot_dot_dot, is_variable) {
                    (true, true) | (false, false) => name,
                    (true, false) => cat!(name, b"_", itoa(&mut ItoaBuf::new(), index)),
                    (false, true) => cat!(name, b"_n"),
                };
            }
            PatKind::Array(elems) if has_dot_dot_dot => {
                let last = elems.iter().next_back();
                let rest = last.filter(|&last| hir[last].is_rest);
                let count = elems.len() - usize::from(rest.is_some());
                if index < count {
                    let element = &hir[elems.at(index)];
                    if !matches!(hir[element.pat].kind, PatKind::Missing) {
                        return self.label_from_binding_element(
                            file,
                            element.pat,
                            element.is_rest,
                            index,
                            flags,
                        );
                    }
                } else if let Some(rest) = rest {
                    return self.label_from_binding_element(
                        file,
                        hir[rest].pat,
                        true,
                        index - count,
                        flags,
                    );
                }
            }
            _ => {}
        }
        cat!(b"arg_", itoa(&mut ItoaBuf::new(), index))
    }

    /// `getTupleElementLabel`, of element `index` of the `arity` elements of the tuple the rest parameter `rest` is. One without a
    /// label of its own is read off the type of the parameter if that is written as a tuple of as many elements.
    fn tuple_element_label(
        &self,
        rest: &Parameter,
        index: usize,
        arity: usize,
        flags: ElemFlags,
    ) -> Vec<u8> {
        if flags.label().is_some() {
            return self.text(flags.label());
        }
        let Some((file, parameter)) = rest.declaration else {
            return cat!(rest.name, b"_", itoa(&mut ItoaBuf::new(), index));
        };
        let hir = self.c.hir(file);
        let parameter = &hir[parameter];
        if parameter.ty.is_some()
            && let TypeNodeKind::Tuple(written) = hir[parameter.ty].kind
            && written.len() == arity
            && hir[written.at(index)].name.is_some()
        {
            return self.text(hir[written.at(index)].name);
        }
        self.label_from_binding_element(file, parameter.pat, true, index, flags)
    }

    /// `getExpandedParameters`: a rest parameter that is a tuple is written as a parameter for each element.
    fn expanded_parameters(&mut self, parameters: &[Parameter]) -> Vec<Parameter> {
        let Some((rest, others)) = parameters.split_last().filter(|split| split.0.rest) else {
            return parameters.to_vec();
        };
        let TypeData::Tuple { flags, .. } = self.c.data(rest.ty) else {
            return parameters.to_vec();
        };
        let elems = self.c.type_arguments(rest.ty);
        let mut names: Vec<Vec<u8>> = (0..elems.len())
            .map(|i| self.tuple_element_label(rest, i, elems.len(), flags[i]))
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
        // With a variadic element that is not the last the list cannot be written.
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
        self.approximate_length += parameter.name_length + 3;
        let text = node.text;
        cat! {
            if parameter.rest { &b"..."[..] } else { b"" }, parameter.name,
            if parameter.optional { &b"?"[..] } else { b"" }, b": ", text
        }
    }

    /// `serializeReturnTypeForSignature`. `parameters`: those the signature declares.
    fn return_type_text(
        &mut self,
        signature: SigId,
        parameters: &[Parameter],
        try_reuse: bool,
    ) -> Vec<u8> {
        let declaration = self.c.sig_decl(signature).map(|of| (of.0, of.1));
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
            return self.type_to_node_without_inference_fallback(returned).text;
        };
        let mut text = Vec::new();
        if predicate.asserts {
            text.extend_from_slice(b"asserts ");
        }
        match predicate.param {
            Some(index) => {
                if let Some(parameter) = parameters.get(index) {
                    text.extend_from_slice(&parameter.name);
                }
            }
            None => text.extend_from_slice(b"this"),
        }
        if let Some(ty) = predicate.ty {
            let ty = self.c.instantiate(ty, self.mapper);
            text.extend_from_slice(b" is ");
            text.extend_from_slice(&self.type_to_node_without_inference_fallback(ty).text);
        }
        text
    }

    /// `signatureToSignatureDeclarationHelper`, as the printer writes it, without the `;` of a member. `name`, `is_optional`: of a method.
    fn signature_to_text(
        &mut self,
        signature: SigId,
        kind: SignatureKind,
        name: &[u8],
        is_optional: bool,
    ) -> Vec<u8> {
        let (declared, expanded, outer_scope) = self.enter_signature_scope(signature);
        self.approximate_length += 3;
        let mut type_parameters = Vec::new();
        let mut own_type_parameters = self.c.sig_type_params(signature).into_vec();
        let mut clones = Vec::new();
        if own_type_parameters.is_empty() {
            own_type_parameters = self.type_parameters_taken_from_context(signature);
            if self.has_inference_context(signature) {
                clones.clone_from(&own_type_parameters);
            }
        }
        for parameter in own_type_parameters {
            type_parameters.push(self.type_parameter_declaration(parameter, &clones));
        }
        let mut parameters = Vec::with_capacity(expanded.len() + 1);
        for parameter in &expanded {
            parameters.push(self.parameter_text(parameter));
        }
        let this = match self.c.sig_this_type(signature) {
            Some(this) => Some((this, signature)),
            None => self.this_parameter_taken_from_context(signature),
        };
        if let Some((this, declared_by)) = this {
            let node = self.serialize_type_of_this_parameter(declared_by, this);
            self.approximate_length += b"this".len() + 3;
            parameters.insert(0, cat!(b"this: ", node.text));
        }
        let returned = self.return_type_text(signature, &declared, true);
        self.leave_scope(outer_scope);
        let type_parameters = if type_parameters.is_empty() {
            Vec::new()
        } else {
            cat!(b"<", type_parameters.join(&b", "[..]), b">")
        };
        let parameters = parameters.join(&b", "[..]);
        match kind {
            SignatureKind::Call => cat!(type_parameters, b"(", parameters, b"): ", returned),
            SignatureKind::Construct => {
                cat!(b"new ", type_parameters, b"(", parameters, b"): ", returned)
            }
            SignatureKind::Method => {
                let question: &[u8] = if is_optional { b"?" } else { b"" };
                cat! { name, question, type_parameters, b"(", parameters, b"): ", returned }
            }
            SignatureKind::FunctionType => {
                cat!(type_parameters, b"(", parameters, b") => ", returned)
            }
            SignatureKind::ConstructorType => {
                let modifier: &[u8] = if self.c.is_abstract_signature(signature) {
                    b"abstract "
                } else {
                    b""
                };
                cat! { modifier, b"new ", type_parameters, b"(", parameters, b") => ", returned }
            }
        }
    }

    /// `enterSignatureScope`: the parameters `signature` declares, `getExpandedParameters`, and what the scope is left by.
    fn enter_signature_scope(
        &mut self,
        signature: SigId,
    ) -> (Vec<Parameter>, Vec<Parameter>, OuterScope) {
        let saved_mapper = self.mapper;
        if let Some((_, _, mapper)) = self.c.sig_decl(signature)
            && self
                .c
                .p
                .types
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
            let mapping = self.c.p.types.mapping(declared.2);
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
        (declared, expanded, outer_scope)
    }

    /// `assignContextualParameterTypes`: `sig.typeParameters = context.typeParameters`
    fn type_parameters_taken_from_context(&mut self, signature: SigId) -> Vec<TypeId> {
        match *self.c.p.types.sig(signature) {
            SigData::WithReturn { sig: inner, .. } => {
                self.type_parameters_taken_from_context(inner)
            }
            _ => self.c.adopted_type_params(signature),
        }
    }

    /// `getInferenceContext(node) != nil` when the function expression `signature` is that of got the types of its parameters: it is
    /// an argument of a call whose type arguments are inferred, or in a literal or a conditional that is. The contextual signature
    /// is instantiated then, and `instantiateSignature` clones its type parameters. Here the function has the declared ones.
    fn has_inference_context(&mut self, signature: SigId) -> bool {
        let (file, func) = match *self.c.p.types.sig(signature) {
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
                        let resolved = self.c.p.calls.get(&(file, parent));
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

    /// `assignContextualParameterTypes`: a context sensitive function that declares no `this` parameter gets that of the signature
    /// it is expected to have (`createSymbolWithType(context.thisParameter, nil)`): its type here, and the signature that declares it.
    fn this_parameter_taken_from_context(&mut self, signature: SigId) -> Option<(TypeId, SigId)> {
        let (file, func, mapper) = match *self.c.p.types.sig(signature) {
            SigData::WithReturn { sig: inner, .. } => {
                return self.this_parameter_taken_from_context(inner);
            }
            SigData::Decl { file, func, mapper } => (file, func, mapper),
            _ => return None,
        };
        let FnOwner::Expr(owner) = self.c.bound(file).fns[func.idx()].owner else {
            return None;
        };
        if !self.c.is_context_sensitive(file, owner) {
            return None;
        }
        let expected = self.c.contextual_signature(file, func)?;
        let this = self.c.sig_this_type(expected)?;
        Some((self.c.instantiate(this, mapper), expected))
    }

    /// A function type or a constructor type.
    fn signature_to_node(&mut self, signature: SigId, kind: SignatureKind) -> Node {
        Node::new(
            self.signature_to_text(signature, kind, b"", false),
            FUNCTION,
        )
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
            // `isMappedTypeWithKeyofConstraintDeclaration`: `keyof` stays, whatever it comes to.
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
            self.text(self.c.hir(file)[mapped.param].name)
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
        self.leave_scope(outer_scope);
        self.approximate_length += 10;
        let readonly: &[u8] = match mapped.readonly {
            MappedModifier::None => b"",
            MappedModifier::Add => b"readonly ",
            MappedModifier::Remove => b"-readonly ",
        };
        let question: &[u8] = match mapped.optional {
            MappedModifier::None => b"",
            MappedModifier::Add => b"?",
            MappedModifier::Remove => b"-?",
        };
        let result = cat! {
            b"{ ", readonly, b"[", name, b" in ", constraint, renamed, b"]", question, b": ",
            template.text, b"; }"
        };
        let (Some(new_name), Some((declared, is_written_with_keyof)), Some(modifiers)) =
            (new_name, over_keyof, modifiers)
        else {
            return Node::simple(result);
        };
        let (check, infer_constraint) = if is_written_with_keyof {
            let original_constraint = match self.c.constraint_of_type_param(declared) {
                Some(constraint) => self.c.instantiate(constraint, mapper),
                None => TypeId::UNKNOWN,
            };
            let original_constraint = if original_constraint == TypeId::UNKNOWN {
                Vec::new()
            } else {
                let constraint = self.type_to_node(original_constraint);
                cat!(b" extends ", constraint.emit(CONDITIONAL + 1))
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

    /// `conditionalTypeToTypeNode`, of the conditional type `ty` written at `node`.
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
        // What is checked was a type parameter and is one no more: a new one keeps the type distributive.
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
            // `prependTypeMapping`
            let mut pairs = self.c.p.types.mapping(mapper).to_vec();
            pairs.retain(|pair| pair.0 != root_check_type);
            pairs.push((root_check_type, new_param));
            mapper = self.c.p.types.mapper(pairs);
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
        // In the `extends` clause a conditional type is in parentheses.
        let extends = extends.emit(CONDITIONAL + 1);
        let (yes, no) = (when_true.text, when_false.text);
        let text = match new_name {
            // The first makes `T` a type parameter, the second gives it what is checked for a constraint, the third is the test.
            Some(t) => {
                let constraint = check.clone().emit(CONDITIONAL + 1);
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

    /// The type `node` denotes under the mapper of the signature being written.
    fn resolved_type_node_to_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        let declared = self.c.type_from_node(file, node);
        let ty = self.c.instantiate(declared, self.mapper);
        self.type_to_node(ty)
    }
}
