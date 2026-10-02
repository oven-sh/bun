//! Types, symbols and signatures as TypeScript writes them in messages.
//!
//! A port of what `typeToString`, `symbolToString` and `signatureToString` come to in `nodebuilderimpl.go` and the printer. There the
//! node builder makes syntax of a type and the printer writes the syntax out. Here a [`Node`] is the text of a type node, with the
//! precedence the printer parenthesizes it by.

use super::*;
use crate::bind::{
    ClassOwner, Decl, FnOwner, InferPosition, MemberOwner, Parent, ScopeId, ScopeKind, SymbolId,
};

/// `nodebuilder.Flags`, those that change what is written when there is no enclosing declaration.
const NO_TRUNCATION: u32 = 1 << 0;
const USE_FULLY_QUALIFIED_TYPE: u32 = 1 << 1;
const ALLOW_UNIQUE_ES_SYMBOL_TYPE: u32 = 1 << 2;
const USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE: u32 = 1 << 3;
const NO_TYPE_REDUCTION: u32 = 1 << 4;
/// There is an enclosing declaration: parameters and results are written as they are annotated.
const REUSES_TYPE_NODES: u32 = 1 << 5;
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

/// `compilerOptions.noErrorTruncation`
fn no_error_truncation(checker: &Checker<'_>) -> bool {
    checker.files().options.no_error_truncation
}

impl Checker<'_> {
    /// `typeToString`
    pub fn type_to_string(&mut self, ty: TypeId) -> String {
        type_to_string_with(
            self,
            ty,
            ALLOW_UNIQUE_ES_SYMBOL_TYPE | USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE,
        )
    }

    /// `TypeToTypeNode` with the flags of `typeWriterWalker.writeTypeOrSymbol`.
    pub fn type_to_string_for_baseline(&mut self, ty: TypeId) -> String {
        type_to_string_with(self, ty, NO_TRUNCATION | ALLOW_UNIQUE_ES_SYMBOL_TYPE)
    }

    /// `getTypeNameForErrorDisplay`
    pub fn type_to_string_fully_qualified(&mut self, ty: TypeId) -> String {
        type_to_string_with(self, ty, USE_FULLY_QUALIFIED_TYPE)
    }

    /// `typeToStringEx(t, nil, TypeFormatFlagsNoTypeReduction)`: an intersection nothing can be is written out, not as `never`.
    pub fn type_to_string_without_reduction(&mut self, ty: TypeId) -> String {
        type_to_string_with(self, ty, NO_TYPE_REDUCTION)
    }

    /// `typeToString` of a type that is made of what `ty` is made of and has no `alias`.
    pub fn type_to_string_written_out(&mut self, ty: TypeId) -> String {
        type_to_string_with(
            self,
            ty,
            ALLOW_UNIQUE_ES_SYMBOL_TYPE | USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE | WRITTEN_OUT,
        )
    }

    /// `typeToString(t, t.symbol.ValueDeclaration)` if `symbolValueDeclarationIsContextSensitive`, which says the opposite of its
    /// name: of a function expression that is not context sensitive. Otherwise `typeToString(t)`.
    fn type_to_string_where_it_is_declared(&mut self, ty: TypeId) -> String {
        let is_enclosed = match self.data(ty) {
            TypeData::Fns { decls, .. } => match decls[..] {
                [(file, func)] => match self.bound(file).fns[func.idx()].owner {
                    FnOwner::Expr(e) => {
                        matches!(self.hir(file)[func].kind, FnKind::Expr | FnKind::Arrow)
                            && !self.is_context_sensitive(file, e)
                    }
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        };
        let flags = ALLOW_UNIQUE_ES_SYMBOL_TYPE | USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE;
        type_to_string_with(
            self,
            ty,
            if is_enclosed {
                flags | REUSES_TYPE_NODES
            } else {
                flags
            },
        )
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
            return (left_text, right_text);
        }
        (
            self.type_to_string_fully_qualified(left),
            self.type_to_string_fully_qualified(right),
        )
    }

    /// Whether `node` is a reference to a type by a name nothing goes by (`getUnresolvedSymbolForEntityName`). From its static
    /// members and from the expression it extends, the type parameters of a class go by nothing.
    fn is_unresolved_type_reference(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let hir = self.hir(file);
        if node.is_none() {
            return false;
        }
        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
            return false;
        };
        if self.intended_type_of_jsdoc_reference(file, node).is_some() {
            return false;
        }
        let scope = self.bound(file).type_scope[node.idx()];
        let names: Vec<Atom> = hir.ids(name).collect();
        match self
            .files()
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
        {
            None => true,
            Some(found) => {
                names.len() == 1
                    && (self.is_static_reference_to_class_type_param(file, node, scope, found)
                        || self.is_base_expression_reference_to_class_type_param(
                            file, node, scope, found,
                        ))
            }
        }
    }

    /// `typeToString` of `constraint`, the base constraint of the type parameter `param`. The error type of a name nothing goes by
    /// is written as the name.
    pub(super) fn base_constraint_to_string(
        &mut self,
        param: TypeId,
        constraint: TypeId,
    ) -> String {
        if constraint == TypeId::ANY
            && let TypeData::TypeParam(file, tp, _) = *self.data(param)
        {
            let node = self.hir(file)[tp].constraint;
            if self.is_unresolved_type_reference(file, node) {
                return with_printer(self, 0, |printer| {
                    printer.type_node_to_node(file, node).text
                });
            }
        }
        self.type_to_string(constraint)
    }

    /// `symbolToString`
    pub fn symbol_to_string(&mut self, symbol: Sym) -> String {
        with_printer(self, 0, |printer| printer.symbol_to_text(symbol))
    }

    /// `symbolToString`, of a property.
    pub fn prop_to_string(&mut self, prop: &Prop) -> String {
        with_printer(self, 0, |printer| {
            printer.name_of_property_as_written(prop, 0)
        })
    }

    /// `signatureToString`. It is cut short whatever `noErrorTruncation` says.
    pub fn signature_to_string(&mut self, signature: SigId) -> String {
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
        with_printer(self, 0, |printer| {
            printer.signature_to_text(signature, kind, "", false)
        })
    }

    /// `t.alias`, as far as it can be told: the type alias `type_to_string` names `ty` by. `None`: it writes `ty` out.
    pub fn alias_for_display(&mut self, ty: TypeId) -> Option<Sym> {
        with_printer(self, 0, |printer| printer.alias_of_type(ty)).map(|alias| alias.0)
    }

    /// `t.alias`, with its type arguments.
    pub(super) fn alias_with_arguments_for_declaration_emit(
        &mut self,
        ty: TypeId,
    ) -> Option<(Sym, Vec<TypeId>)> {
        with_printer(self, 0, |printer| printer.alias_of_type(ty))
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

/// `typeToStringEx`
fn type_to_string_with(checker: &mut Checker<'_>, ty: TypeId, flags: u32) -> String {
    let no_truncation = no_error_truncation(checker);
    let flags = if no_truncation {
        flags | NO_TRUNCATION
    } else {
        flags
    };
    let text = with_printer(checker, flags, |printer| printer.type_to_node(ty).text);
    let maximum = 2 * if no_truncation {
        NO_TRUNCATION_MAXIMUM_TRUNCATION_LENGTH
    } else {
        DEFAULT_MAXIMUM_TRUNCATION_LENGTH
    };
    if text.len() < maximum {
        return text;
    }
    let mut end = maximum - "...".len();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &text[..end])
}

/// Printing resolves what it comes across. A circle that goes through here is nobody's error, and what the check under way has found
/// out so far stays what it was.
fn with_printer<'p, T>(
    checker: &mut Checker<'p>,
    flags: u32,
    print: impl FnOnce(&mut Printer<'_, 'p>) -> T,
) -> T {
    let saved = (
        checker.uncertain,
        checker.relation_gave_up,
        checker.relation_too_complex,
        checker.union_too_complex,
    );
    checker.eager.push(checker.stack.len());
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
            depth: 0,
            comparison_depth: 0,
        };
        print(&mut printer)
    };
    checker.eager.pop();
    (
        checker.uncertain,
        checker.relation_gave_up,
        checker.relation_too_complex,
        checker.union_too_complex,
    ) = saved;
    result
}

/// A type node as the printer writes it.
struct Node {
    text: String,
    /// `GetTypeNodePrecedence`
    precedence: u8,
    /// `isIdentifierTypeReference`: the name, of a type reference whose name is one identifier.
    reference: Option<String>,
}

impl Node {
    fn new(text: impl Into<String>, precedence: u8) -> Node {
        Node {
            text: text.into(),
            precedence,
            reference: None,
        }
    }

    fn simple(text: impl Into<String>) -> Node {
        Node::new(text, NON_ARRAY)
    }

    /// `emitTypeNode(node, precedence)`
    fn emit(self, at_least: u8) -> String {
        if self.precedence < at_least {
            format!("({})", self.text)
        } else {
            self.text
        }
    }
}

fn join_nodes(nodes: Vec<Node>, separator: &str, at_least: u8) -> String {
    let parts: Vec<String> = nodes.into_iter().map(|node| node.emit(at_least)).collect();
    parts.join(separator)
}

/// `emitTypeArguments`
fn type_arguments_text(nodes: Vec<Node>) -> String {
    if nodes.is_empty() {
        String::new()
    } else {
        format!("<{}>", join_nodes(nodes, ", ", CONDITIONAL))
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
    Function(FileId, FnId),
    Conditional(FileId, TypeNodeId),
    Type(TypeId),
}

/// A parameter symbol of a signature.
#[derive(Clone)]
struct Parameter {
    name: String,
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

/// What `CompareTypes` looks at first.
struct SortKey {
    ty: TypeId,
    flags: u32,
    name: Option<Vec<u8>>,
    alias: Option<(Sym, Vec<TypeId>)>,
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
    /// It may have one, which is not kept.
    Unknown,
}

/// `NodeBuilderImpl` and its `NodeBuilderContext`.
impl<'p> Checker<'p> {
    /// Finds out what the type aliases of `file` that `plain_alias_of` is about stand for and, with `fills_in`, fills it in for them.
    fn name_plain_aliases(&mut self, file: FileId, fills_in: bool) {
        let files = self.files();
        let module = &files.modules[file.idx()];
        for (a, alias) in module.hir.aliases.iter().enumerate() {
            let symbol = module.bound.alias_symbol[a];
            if !alias.type_params.is_empty()
                || alias.ty.is_none()
                || symbol.is_none()
                || !matches!(
                    module.hir[alias.ty].kind,
                    TypeNodeKind::Union(_) | TypeNodeKind::Intersection(_)
                )
            {
                continue;
            }
            // `intersectUnionsOfPrimitiveTypes`: what unions of primitives and nothing else come to is made without the alias.
            if let TypeNodeKind::Intersection(list) = module.hir[alias.ty].kind {
                let mut are_primitive_unions = list.len() > 1;
                for member in module.hir.ids(list) {
                    let member = self.type_from_node(file, member);
                    let member = self.force(member);
                    are_primitive_unions &= self.is_union(member)
                        && self
                            .parts(member)
                            .iter()
                            .all(|&part| self.is_primitive(part));
                }
                if are_primitive_unions {
                    continue;
                }
            }
            let symbol = files.sym(file, symbol);
            let ty = self.declared_type(symbol);
            if fills_in
                && matches!(
                    self.data(ty),
                    TypeData::Union(_) | TypeData::Intersection(_)
                )
                && self.p.plain_alias_of.get(&ty).is_none()
            {
                self.p.plain_alias_of.insert(ty, Some(symbol));
            }
        }
    }
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
    depth: u32,
    comparison_depth: u32,
}

/// `escapeStringWorker`
fn escape_string(text: &str, quote: char, escapes_non_ascii: bool, out: &mut String) {
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '$' if quote == '`' && chars.peek() == Some(&'{') => out.push_str("\\$"),
            '"' | '\'' | '`' if ch == quote => {
                out.push('\\');
                out.push(ch);
            }
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            '\u{85}' => out.push_str("\\u0085"),
            // The line feed after it goes with it, in a template too.
            '\r' if quote == '`' && chars.peek() == Some(&'\n') => {
                chars.next();
                out.push_str("\\r\\n");
            }
            '\r' => out.push_str("\\r"),
            // A template keeps its line feeds.
            '\n' if quote == '`' => out.push('\n'),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\u{b}' => out.push_str("\\v"),
            '\u{c}' => out.push_str("\\f"),
            '\u{8}' => out.push_str("\\b"),
            '\0' if chars.peek().is_some_and(char::is_ascii_digit) => out.push_str("\\x00"),
            '\0' => out.push_str("\\0"),
            _ if u32::from(ch) < 0x20 || escapes_non_ascii && !ch.is_ascii() => {
                let mut units = [0u16; 2];
                for unit in ch.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04X}"));
                }
            }
            _ => out.push(ch),
        }
    }
}

/// A string literal. `escapes_non_ascii`: it is written without `EFNoAsciiEscaping`.
fn quoted(text: &str, quote: char, escapes_non_ascii: bool) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push(quote);
    escape_string(text, quote, escapes_non_ascii, &mut out);
    out.push(quote);
    out
}

/// `quoted`, of text in which half a surrogate pair stands alone (three bytes that are no UTF-8): it is written as the escape it is.
fn quoted_with_lone_surrogates(mut rest: &[u8], quote: char) -> String {
    let mut out = String::with_capacity(rest.len() + 2);
    out.push(quote);
    while !rest.is_empty() {
        let valid = match std::str::from_utf8(rest) {
            Ok(_) => rest.len(),
            Err(error) => error.valid_up_to(),
        };
        let (text, after) = rest.split_at(valid);
        escape_string(&String::from_utf8_lossy(text), quote, false, &mut out);
        rest = match *after {
            [0xED, high @ 0xA0..=0xBF, low @ 0x80..=0xBF, ..] => {
                let unit = 0xD000 | u32::from(high & 0x3F) << 6 | u32::from(low & 0x3F);
                out.push_str(&format!("\\u{unit:04X}"));
                &after[3..]
            }
            [_, ..] => {
                out.push('\u{FFFD}');
                &after[1..]
            }
            [] => after,
        };
    }
    out.push(quote);
    out
}

/// `IsIdentifierText`
fn is_identifier_text(text: &str) -> bool {
    use super::errors_x_regexp_scanner::{is_identifier_part, is_identifier_start};
    let mut chars = text.chars();
    chars
        .next()
        .is_some_and(|first| is_identifier_start(u32::from(first)))
        && chars.all(|ch| is_identifier_part(u32::from(ch)))
}

/// `RemoveFileExtension`
fn without_extension(path: &str) -> &str {
    const EXTENSIONS: [&str; 12] = [
        ".d.ts", ".d.mts", ".d.cts", ".mjs", ".mts", ".cjs", ".cts", ".ts", ".js", ".tsx", ".jsx",
        ".json",
    ];
    EXTENSIONS
        .iter()
        .find_map(|extension| path.strip_suffix(*extension))
        .unwrap_or(path)
}

/// Past the bracket that closes the one at `open`.
fn end_of_brackets(text: &[u8], open: usize) -> usize {
    let (mut depth, mut i) = (0usize, open);
    while i < text.len() {
        match text[i] {
            b'[' | b'(' | b'{' => depth += 1,
            b']' | b')' | b'}' => {
                if depth <= 1 {
                    return i + 1;
                }
                depth -= 1;
            }
            quote @ (b'"' | b'\'' | b'`') => {
                i += 1;
                while i < text.len() && text[i] != quote {
                    if text[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    text.len()
}

fn string_mapping_name(kind: StringMappingKind) -> &'static str {
    match kind {
        StringMappingKind::Uppercase => "Uppercase",
        StringMappingKind::Lowercase => "Lowercase",
        StringMappingKind::Capitalize => "Capitalize",
        StringMappingKind::Uncapitalize => "Uncapitalize",
    }
}

impl<'p> Printer<'_, 'p> {
    fn text(&self, name: Atom) -> String {
        if name.is_none() {
            return String::new();
        }
        String::from_utf8_lossy(self.c.files().atoms.bytes(name)).into_owned()
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
            "any"
        } else {
            "..."
        })
    }

    /// `... n more ...`
    fn more_elided(&self, count: usize) -> Node {
        if self.flags & NO_TRUNCATION != 0 {
            Node::simple("any")
        } else {
            Node::simple(format!("... {count} more ..."))
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
                let (text, length) = match intrinsic {
                    Intrinsic::Unresolved | Intrinsic::Any => ("any", 3),
                    Intrinsic::Unknown => ("unknown", 0),
                    Intrinsic::Never => ("never", 5),
                    Intrinsic::Void => ("void", 4),
                    Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => {
                        ("undefined", 9)
                    }
                    Intrinsic::Null | Intrinsic::NullDeclared => ("null", 4),
                    Intrinsic::String => ("string", 6),
                    Intrinsic::Number => ("number", 6),
                    Intrinsic::BigInt => ("bigint", 6),
                    Intrinsic::Symbol => ("symbol", 6),
                    Intrinsic::Object => ("object", 6),
                };
                self.approximate_length += length;
                return Node::simple(text);
            }
            TypeData::Union(_) if ty == TypeId::BOOLEAN => {
                self.approximate_length += 7;
                return Node::simple("boolean");
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
                let bytes = self.c.files().atoms.bytes(*value);
                if std::str::from_utf8(bytes).is_err() {
                    self.approximate_length += bytes.len() + 2;
                    return Node::simple(quoted_with_lone_surrogates(bytes, '"'));
                }
                let value = self.text(*value);
                self.approximate_length += value.len() + 2;
                return Node::simple(quoted(&value, '"', false));
            }
            TypeData::NumberLit { bits, .. } => {
                let text = crate::atom::number_to_string(f64::from_bits(*bits));
                self.approximate_length += text.len();
                return Node::simple(text);
            }
            TypeData::BigIntLit { text, negative, .. } => {
                let digits = self.text(*text);
                let digits = digits.strip_suffix('n').unwrap_or(&digits);
                let sign = if *negative { "-" } else { "" };
                self.approximate_length += sign.len() + digits.len() + 1;
                return Node::simple(format!("{sign}{digits}n"));
            }
            TypeData::BoolLit { value, .. } => {
                self.approximate_length += if *value { 4 } else { 5 };
                return Node::simple(if *value { "true" } else { "false" });
            }
            TypeData::UniqueSymbol { file, name, .. } => {
                if self.flags & ALLOW_UNIQUE_ES_SYMBOL_TYPE != 0 {
                    self.approximate_length += 13;
                    return Node::new("unique symbol", TYPE_OPERATOR);
                }
                let name = self.text(*name);
                // A property of the global `SymbolConstructor`.
                if file.0 == u32::MAX {
                    self.approximate_length += 6 + 2 * ("Symbol".len() + 1) + 2 * (name.len() + 1);
                    return Node::new(format!("typeof Symbol.{name}"), TYPE_OPERATOR);
                }
                self.approximate_length += 6 + 2 * (name.len() + 1);
                return Node::new(format!("typeof {name}"), TYPE_OPERATOR);
            }
            TypeData::ThisParam(_) => {
                self.approximate_length += 4;
                return Node::simple("this");
            }
            _ => {}
        }
        let is_written_out = self.flags & WRITTEN_OUT != 0 && self.depth == 1;
        if !is_written_out && let Some((alias, arguments)) = self.alias_of_type(ty) {
            let arguments = self.map_to_type_nodes(&arguments, false);
            return self.symbol_to_type_node(alias, false, arguments);
        }
        match self.c.data(ty) {
            TypeData::Ref { target, args } => self.type_reference_to_node(ty, *target, args),
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => self.tuple_to_node(elems, flags, *readonly),
            TypeData::TypeParam(..) => self.type_parameter_to_node(ty),
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
                Node::new(format!("keyof {}", of.emit(TYPE_OPERATOR)), TYPE_OPERATOR)
            }
            TypeData::Template { texts, types } => self.template_to_node(texts, types),
            TypeData::StringMapping { kind, ty: of } => {
                let of = self.type_to_node(*of);
                self.intrinsic_alias_to_node(string_mapping_name(*kind), of)
            }
            TypeData::NoInfer(of) => {
                let of = self.type_to_node(*of);
                self.intrinsic_alias_to_node("NoInfer", of)
            }
            TypeData::IndexedAccess { obj, index, .. } => {
                let object = self.type_to_node(*obj);
                let index = self.type_to_node(*index);
                self.approximate_length += 2;
                Node::new(format!("{}[{}]", object.emit(POSTFIX), index.text), POSTFIX)
            }
            TypeData::Cond { file, node, .. } => {
                let identity = Some(Identity::Conditional(*file, *node));
                let Some(depth) = self.enter_type(ty, identity) else {
                    return self.elided_information_placeholder();
                };
                let result = self.conditional_type_to_node(ty, *file, *node);
                self.leave_type(ty, identity, depth);
                result
            }
            // Written above.
            _ => Node::simple("any"),
        }
    }

    /// `symbolToTypeNode` of `Uppercase`, `NoInfer` and the like, with one type argument.
    fn intrinsic_alias_to_node(&mut self, name: &str, argument: Node) -> Node {
        self.approximate_length += 2 * (name.len() + 1);
        Node::simple(format!("{name}<{}>", argument.text))
    }

    /// The name of a type parameter that has no symbol.
    fn name_of_marker(&self, marker: u8) -> String {
        let parameter = VARIANCE_TYPE_PARAMETER.with(std::cell::Cell::get);
        match marker {
            3 if parameter.is_some() => format!("super-{}", self.text(parameter)),
            4 if parameter.is_some() => format!("sub-{}", self.text(parameter)),
            _ => "?".to_owned(),
        }
    }

    fn template_to_node(&mut self, texts: &[Atom], types: &[TypeId]) -> Node {
        let mut text = String::from("`");
        for (i, &piece) in texts.iter().enumerate() {
            let piece = self.text(piece);
            escape_string(&piece, '`', false, &mut text);
            if let Some(&ty) = types.get(i) {
                let node = self.type_to_node(ty);
                text.push_str("${");
                text.push_str(&node.text);
                text.push('}');
            }
        }
        text.push('`');
        self.approximate_length += 2;
        Node::simple(text)
    }

    /// The first half of `visitAndTransformType`. `None`: it is too deep in instantiations of the same thing.
    fn enter_type(&mut self, ty: TypeId, identity: Option<Identity>) -> Option<u32> {
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
                        return None;
                    }
                    entry.1 = depth + 1;
                }
                None => self.symbol_depth.push((identity, 1)),
            }
        }
        self.visited_types.push(ty);
        Some(depth)
    }

    /// The second half.
    fn leave_type(&mut self, ty: TypeId, identity: Option<Identity>, depth: u32) {
        self.visited_types.retain(|&visited| visited != ty);
        if let Some(identity) = identity
            && let Some(entry) = self
                .symbol_depth
                .iter_mut()
                .find(|entry| entry.0 == identity)
        {
            entry.1 = depth;
        }
    }

    // ───────────────────────────── enums ─────────────────────────────

    /// The enum whose declared type is the union `ty` of `members`.
    fn enum_of_members(&mut self, ty: TypeId, members: &[TypeId]) -> Option<Sym> {
        let member = match *self.c.data(*members.first()?) {
            TypeData::EnumLit { member, .. } => member,
            TypeData::Enum { symbol, .. } => symbol,
            _ => return None,
        };
        let parent = self.parent_of_symbol(member)?;
        (self.c.enum_type_of_member(member) == ty).then_some(parent)
    }

    /// `E.A`, or `E` if the member is all there is to the enum.
    fn enum_member_to_node(&mut self, ty: TypeId, member: Sym) -> Node {
        let Some(parent) = self.parent_of_symbol(member) else {
            return self.symbol_to_type_node(member, false, Vec::new());
        };
        let parent_name = self.symbol_to_type_node(parent, false, Vec::new());
        if self.c.enum_type_of_member(member) == ty {
            return parent_name;
        }
        let name = self.text(self.c.files().symbol(member).name);
        if is_identifier_text(&name) {
            return Node::simple(format!("{}.{name}", parent_name.text));
        }
        let literal = quoted(&name, '"', true);
        if parent_name.text.starts_with("import(") {
            Node::new(format!("typeof {}[{literal}]", parent_name.text), POSTFIX)
        } else {
            Node::new(format!("(typeof {})[{literal}]", parent_name.text), POSTFIX)
        }
    }

    // ───────────────────────────── symbols ─────────────────────────────

    /// `getParentOfSymbol`
    fn parent_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        let files = self.c.files();
        let parent = files.symbol(symbol).parent;
        parent.is_some().then(|| files.sym(symbol.file, parent))
    }

    /// `core.Some(symbol.Declarations, hasNonGlobalAugmentationExternalModuleSymbol)`
    fn is_external_module(&self, symbol: Sym) -> bool {
        let files = self.c.files();
        files
            .decls(symbol)
            .into_iter()
            .any(|(file, decl)| match decl {
                Decl::File => files.module(file).is_module(),
                Decl::Module(m) => matches!(self.c.hir(file)[m].name, ModuleName::String(_)),
                _ => false,
            })
    }

    /// `getSpecifierForModuleSymbol` without an enclosing file: the name of the symbol without its quotes.
    fn specifier_of_module(&self, symbol: Sym) -> String {
        let files = self.c.files();
        let decls = files.decls(symbol);
        if let Some(&(file, _)) = decls.iter().find(|d| d.1 == Decl::File) {
            return without_extension(&files.module(file).path).to_owned();
        }
        for &(file, decl) in &decls {
            if let Decl::Module(m) = decl
                && let ModuleName::String(name) = self.c.hir(file)[m].name
            {
                return self.text(name);
            }
        }
        String::new()
    }

    /// Whether `symbol.Name` is `default`. The binder keeps a default export under the name it is declared with.
    fn is_default_export(&self, symbol: Sym) -> bool {
        let declared = self.c.files().symbol(symbol);
        if declared.parent.is_none() {
            return false;
        }
        let hir = self.c.hir(symbol.file);
        let modifiers = declared
            .decls
            .iter()
            .find_map(|&decl| match decl {
                Decl::Class(class) => Some(hir[class].flags),
                Decl::Interface(interface) => Some(hir[interface].flags),
                _ => None,
            })
            .or_else(|| {
                declared.decls.iter().find_map(|&decl| match decl {
                    Decl::Fn(function) => Some(hir[function].flags),
                    _ => None,
                })
            });
        modifiers.is_some_and(|flags| flags.contains(Flags::DEFAULT))
    }

    /// The string, the number or the `[computed]` name written at `pos`, as it is written. `None`: something else is written there,
    /// or the text of the file is not kept. `is_computed`: `pos` may be that of the expression in the brackets.
    fn written_literal_name(&self, file: FileId, pos: u32, is_computed: bool) -> Option<String> {
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
            b'[' => end_of_brackets(text, start),
            b'"' | b'\'' | b'0'..=b'9' => super::explain::end_of_token(text, start as u32) as usize,
            _ => return None,
        };
        let end = end.clamp(start, text.len());
        Some(String::from_utf8_lossy(&text[start..end]).into_owned())
    }

    /// `a`, `a.b.c`
    fn entity_name_text(&self, file: FileId, e: ExprId) -> Option<String> {
        match self.c.hir(file)[e].kind {
            ExprKind::Ident(name) => Some(self.text(name)),
            ExprKind::Dot { obj, name, .. } => Some(format!(
                "{}.{}",
                self.entity_name_text(file, obj)?,
                self.text(name)
            )),
            _ => None,
        }
    }

    /// `DeclarationNameToString`, of the name `key` written at `pos`.
    fn property_key_text(&self, file: FileId, key: PropKey, pos: u32) -> String {
        if let Some(text) =
            self.written_literal_name(file, pos, matches!(key, PropKey::Computed(_)))
        {
            return text;
        }
        match key {
            PropKey::Name(name) => {
                let name = self.text(name);
                let is_bare = is_identifier_text(&name)
                    || name.starts_with(|first: char| first.is_ascii_digit())
                    // The name of a JSX attribute.
                    || !self.c.hir(file).text.is_empty();
                if is_bare {
                    name
                } else {
                    quoted(&name, '"', false)
                }
            }
            PropKey::Private(name) => {
                String::from_utf8_lossy(self.c.written_name(name)).into_owned()
            }
            PropKey::Computed(e) => match self.entity_name_text(file, e) {
                Some(name) => format!("[{name}]"),
                None => "(Missing)".to_owned(),
            },
            PropKey::None => "(Missing)".to_owned(),
        }
    }

    /// `DeclarationNameToString(GetNameOfDeclaration(decl))`
    fn name_of_declaration(&self, file: FileId, decl: Decl) -> Option<String> {
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
            Decl::EnumMember(member) => {
                return Some(self.property_key_text(
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
                            .unwrap_or_else(|| quoted(&self.text(name), '"', false)),
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
            _ => Atom::NONE,
        };
        name.is_some().then(|| self.text(name))
    }

    /// `DeclarationNameToString(GetAssignedName(e))`: the name of what `e` is given to.
    fn name_of_initialized_variable(&self, file: FileId, e: ExprId) -> Option<String> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let parent = bound.expr_parent[e.idx()];
        if let Parent::VarInit(declaration) = parent {
            return match hir[hir[declaration].pat].kind {
                PatKind::Ident(name) => Some(self.text(name)),
                _ => None,
            };
        }
        // What is in parentheses is given to nothing.
        if self.c.is_written_in_parentheses(file, e) {
            return None;
        }
        let written = |pat: PatId| {
            self.c
                .source_text(file, hir[pat].pos, self.c.end_of_pat(file, pat))
        };
        match parent {
            // Not the attribute of a JSX element.
            Parent::Prop(p)
                if hir[p].kind == PropKind::Init
                    && matches!(hir[bound.prop_owner[p.idx()]].kind, ExprKind::Object(_)) =>
            {
                Some(self.property_key_text(file, hir[p].key, hir[p].pos))
            }
            Parent::PatPropDefault(p) => Some(written(hir[p].value)),
            Parent::PatElemDefault(p) => Some(written(hir[p].pat)),
            Parent::Expr(outer) if outer.is_some() => {
                let left = match hir[outer].kind {
                    ExprKind::Assign { target, value, .. } if value == e => target,
                    ExprKind::Binary { left, right, .. } if right == e => left,
                    _ => return None,
                };
                if self.c.is_written_in_parentheses(file, left) {
                    return None;
                }
                match hir[left].kind {
                    ExprKind::Ident(name) | ExprKind::Dot { name, .. } => Some(self.text(name)),
                    ExprKind::Index { index, .. }
                        if matches!(hir[index].kind, ExprKind::String(_) | ExprKind::Number(_)) =>
                    {
                        let end = self.c.end_inside_parentheses(file, index);
                        Some(self.c.source_text(file, hir[index].pos, end))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// `getNameOfSymbolAsWritten`. `is_initial`: `FlagsInInitialEntityName`.
    fn name_of_symbol_as_written(&self, symbol: Sym, is_initial: bool) -> String {
        let files = self.c.files();
        let decls = files.decls(symbol);
        let is_default = self.is_default_export(symbol);
        if is_default
            && self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0
            && (!is_initial || decls.is_empty())
        {
            return "default".to_owned();
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
                        .unwrap_or_else(|| "(Anonymous class)".to_owned());
                }
            }
            Some(&(file, Decl::Fn(function))) => {
                if let FnOwner::Expr(e) = self.c.bound(file).fns[function.idx()].owner {
                    return self
                        .name_of_initialized_variable(file, e)
                        .unwrap_or_else(|| "(Anonymous function)".to_owned());
                }
            }
            Some(&(file, Decl::File)) => {
                return format!("\"{}\"", without_extension(&files.module(file).path));
            }
            _ => {}
        }
        if is_default {
            return "default".to_owned();
        }
        let name = files.symbol(symbol).name;
        if name.is_some() {
            return files.atoms.text(name).into_owned();
        }
        match decls.first() {
            Some(&(_, Decl::Class(_))) => "__class".to_owned(),
            Some(&(_, Decl::Fn(_))) => "__function".to_owned(),
            _ => "__type".to_owned(),
        }
    }

    /// The name `symbol` goes by in the exports of its parent.
    fn export_name(&self, symbol: Sym) -> String {
        if self.is_default_export(symbol) {
            return "default".to_owned();
        }
        let name = self.c.files().symbol(symbol).name;
        if name.is_some() {
            self.text(name)
        } else {
            self.name_of_symbol_as_written(symbol, false)
        }
    }

    /// `symbolToExpression` of a chain of one, as `symbolToString` has it.
    fn symbol_to_text(&mut self, symbol: Sym) -> String {
        let name = self.name_of_symbol_as_written(symbol, true);
        if name.starts_with(|first: char| first == '"' || first == '\'')
            && self.is_external_module(symbol)
        {
            return quoted(&self.specifier_of_module(symbol), '"', true);
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
        let is_module = self.is_external_module(symbol);
        let name = files.symbol(symbol).name;
        let is_global = name.is_some() && files.globals.get(&name) == Some(&symbol);
        if is_global && !is_module {
            return Some(vec![symbol]);
        }
        if depth < 32
            && let Some(parent) = self.parent_of_symbol(symbol)
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

    /// `symbolToTypeNode`. `is_type_of`: the meaning is `SymbolFlagsValue`.
    fn symbol_to_type_node(
        &mut self,
        symbol: Sym,
        is_type_of: bool,
        type_arguments: Vec<Node>,
    ) -> Node {
        let yields_module = self.flags & USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE == 0;
        let chain = self.lookup_symbol_chain(symbol, yields_module);
        let mut qualifier = String::new();
        for &part in &chain[1..] {
            let name = self.export_name(part);
            self.approximate_length += name.len() + 1;
            qualifier.push('.');
            qualifier.push_str(&name);
        }
        let type_arguments = type_arguments_text(type_arguments);
        let query = if is_type_of { "typeof " } else { "" };
        if self.is_external_module(chain[0]) {
            let specifier = self.specifier_of_module(chain[0]);
            self.approximate_length += specifier.len() + 10;
            return Node::simple(format!(
                "{query}import({}){qualifier}{type_arguments}",
                quoted(&specifier, '"', true)
            ));
        }
        let name = self.name_of_symbol_as_written(chain[0], true);
        self.approximate_length += 2 * (name.len() + 1);
        if is_type_of {
            return Node::new(format!("typeof {name}{qualifier}"), TYPE_OPERATOR);
        }
        Node {
            text: format!("{name}{qualifier}{type_arguments}"),
            precedence: NON_ARRAY,
            reference: (chain.len() == 1).then_some(name),
        }
    }

    // ───────────────────────────── aliases ─────────────────────────────

    /// `t.alias`. Types do not keep it. An object, function or conditional type has it if its syntax is the whole body of a type
    /// alias. A union or an intersection is looked up among what the aliases of the program stand for.
    fn alias_of_type(&mut self, ty: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        if let Some(hosting) = self.c.hosting_alias_of(ty) {
            return Some(hosting);
        }
        let (file, node, mapper) = match self.c.data(ty) {
            TypeData::LazyAlias { sym, args } => return Some((*sym, args.to_vec())),
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node),
                mapper,
            } => (*file, *node, *mapper),
            TypeData::Cond { file, node, mapper } => (*file, *node, *mapper),
            TypeData::IndexedAccess { obj, index, .. } => {
                self.written_indexed_access(*obj, *index)?
            }
            TypeData::Fns { decls, mapper } => {
                let [(file, func)] = decls[..] else {
                    return None;
                };
                let FnOwner::Type(node) = self.c.bound(file).fns[func.idx()].owner else {
                    return None;
                };
                (file, node, *mapper)
            }
            TypeData::Union(_) | TypeData::Intersection(_) => {
                return self.alias_of_union_or_intersection(ty);
            }
            _ => return None,
        };
        let index = self
            .c
            .hir(file)
            .aliases
            .iter()
            .position(|alias| alias.ty == node)?;
        let symbol = self.c.bound(file).alias_symbol[index];
        if symbol.is_none() {
            return None;
        }
        let alias = self.c.files().sym(file, symbol);
        // A class or an interface of the same name is what the name means.
        if self
            .c
            .files()
            .flags(alias)
            .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            return None;
        }
        let parameters = self.c.type_params_of_symbol(alias);
        let arguments = parameters
            .iter()
            .map(|&parameter| self.c.p.types.map(mapper, parameter).unwrap_or(parameter))
            .collect();
        Some((alias, arguments))
    }

    /// Where `obj[index]` is written as the whole body of a type alias, and under which mapper: `obj` is a type literal or a mapped
    /// type written there.
    fn written_indexed_access(
        &mut self,
        obj: TypeId,
        index: TypeId,
    ) -> Option<(FileId, TypeNodeId, MapperId)> {
        let TypeData::Anon {
            origin: Origin::TypeLiteral(file, object) | Origin::Mapped(file, object),
            mapper,
        } = *self.c.data(obj)
        else {
            return None;
        };
        let hir = self.c.hir(file);
        let (node, written) = hir.aliases.iter().find_map(|alias| {
            if alias.ty.is_none() {
                return None;
            }
            match hir[alias.ty].kind {
                TypeNodeKind::IndexedAccess { obj, index } if obj == object => {
                    Some((alias.ty, index))
                }
                _ => None,
            }
        })?;
        let declared = self.c.type_from_node(file, written);
        (self.c.instantiate(declared, mapper) == index).then_some((file, node, mapper))
    }

    /// The type node a type alias is declared to stand for.
    fn body_of_alias(&self, alias: Sym) -> Option<(FileId, TypeNodeId)> {
        self.c
            .files()
            .decls(alias)
            .into_iter()
            .find_map(|(file, decl)| match decl {
                Decl::Alias(declaration) => {
                    let body = self.c.hir(file)[declaration].ty;
                    body.is_some().then_some((file, body))
                }
                _ => None,
            })
    }

    fn alias_of_union_or_intersection(&mut self, ty: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        if ty == TypeId::BOOLEAN {
            return None;
        }
        // `getTypeFromUnionTypeNode`, `getTypeFromIntersectionTypeNode`, `instantiateMappedType`: what a conditional type comes to
        // has no alias.
        if let Some((alias, arguments)) = self.c.p.alias_of.get(&ty)
            && let Some((file, body)) = self.body_of_alias(alias)
            && matches!(
                self.c.hir(file)[body].kind,
                TypeNodeKind::Union(_) | TypeNodeKind::Intersection(_) | TypeNodeKind::Mapped(_)
            )
        {
            return Some((alias, arguments.to_vec()));
        }
        // `getGlobalNonNullableTypeInstantiation`: `T & {}` is nearly always made as `NonNullable<T>`.
        if let TypeData::Intersection(members) = self.c.data(ty)
            && let [a, b] = members[..]
            && (a == TypeId::EMPTY_OBJECT || b == TypeId::EMPTY_OBJECT)
            && self.c.p.written_with_empty_object.get(&ty).is_none()
            && let Some(alias) = self.c.global_type_symbol(known::NonNullable)
            && self.c.files().flags(alias).contains(SymFlags::TYPE_ALIAS)
        {
            let of = if a == TypeId::EMPTY_OBJECT { b } else { a };
            if self.c.has_type_variables(of) {
                return Some((alias, vec![of]));
            }
        }
        let is_union = self.c.is_union(ty);
        if (!is_union || self.c.p.named_unions.get(&ty).is_some())
            && let Some(alias) = self.plain_alias_of(ty)
        {
            return Some((alias, Vec::new()));
        }
        if is_union {
            self.generic_alias_of_union(ty)
        } else {
            None
        }
    }

    /// The first type alias without type parameters, outside the default library, that is written as a union or an intersection
    /// and stands for `ty`. The same members written out elsewhere are the same type here, and are named too.
    fn plain_alias_of(&mut self, ty: TypeId) -> Option<Sym> {
        let program = self.c.p;
        if program.are_plain_aliases_known.get().is_none() {
            let modules = &program.files.modules;
            let counts = |index: usize| !modules[index].is_lib && !modules[index].is_transient;
            // Asked from outside, whatever is under way here.
            let mut checker = program.checker();
            // What the aliases stand for can be found out in any order, so whoever needs the table helps instead of waiting for it.
            loop {
                let index = program
                    .plain_aliases_resolved
                    .fetch_add(1, Ordering::Relaxed);
                if index >= modules.len() {
                    break;
                }
                if counts(index) {
                    checker.name_plain_aliases(FileId(index as u32), false);
                }
            }
            program.are_plain_aliases_known.get_or_init(|| {
                for index in (0..modules.len()).filter(|&index| counts(index)) {
                    checker.name_plain_aliases(FileId(index as u32), true);
                }
            });
        }
        // Those of the file at hand are only known here.
        if crate::local::is_on() {
            let file = FileId(crate::local::file());
            if self.c.named_plain_aliases_of != Some(file) {
                self.c.named_plain_aliases_of = Some(file);
                program.checker().name_plain_aliases(file, true);
            }
        }
        self.c.p.plain_alias_of.get(&ty).flatten()
    }

    /// `IteratorResult<T, TReturn>` for `IteratorYieldResult<T> | IteratorReturnResult<TReturn>`: the generic type alias, written as
    /// a union of references to classes and interfaces, that comes to `ty` with the type arguments read off the members of `ty`.
    fn generic_alias_of_union(&mut self, ty: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        let TypeData::Union(members) = self.c.data(ty) else {
            return None;
        };
        let is_generic_reference = |c: &Checker<'p>, t: TypeId| matches!(c.data(t), TypeData::Ref { args, .. } if !args.is_empty());
        if !members.iter().all(|&m| is_generic_reference(&*self.c, m)) {
            return None;
        }
        if self.c.p.generic_union_aliases.len() == 0 {
            return None;
        }
        let files = self.c.files();
        for (index, module) in files.modules.iter().enumerate() {
            // Another thread may have it at hand.
            if module.is_transient && !FileId(index as u32).is_local() {
                continue;
            }
            for (a, alias) in module.hir.aliases.iter().enumerate() {
                if alias.type_params.is_empty() || alias.ty.is_none() {
                    continue;
                }
                let TypeNodeKind::Union(written) = module.hir[alias.ty].kind else {
                    continue;
                };
                let symbol = module.bound.alias_symbol[a];
                if written.len() != members.len() || symbol.is_none() {
                    continue;
                }
                let symbol = files.sym(FileId(index as u32), symbol);
                let Some(declared) = self.c.p.declared_types.get(&symbol) else {
                    continue;
                };
                let TypeData::Union(patterns) = self.c.data(declared) else {
                    continue;
                };
                if patterns.len() != members.len()
                    || !patterns.iter().all(|&p| is_generic_reference(&*self.c, p))
                {
                    continue;
                }
                let parameters = self.c.type_params_of_symbol(symbol);
                let mut arguments: Vec<Option<TypeId>> = vec![None; parameters.len()];
                let fits = patterns.iter().all(|&pattern| {
                    members.iter().any(|&member| {
                        let mut attempt = arguments.clone();
                        let fits = self.unify(pattern, member, &parameters, &mut attempt);
                        if fits {
                            arguments = attempt;
                        }
                        fits
                    })
                });
                let Some(arguments) = arguments.into_iter().collect::<Option<Vec<TypeId>>>() else {
                    continue;
                };
                if !fits {
                    continue;
                }
                let mapper = self.c.mapper_from(&parameters, &arguments);
                if self.c.instantiate(declared, mapper) == ty {
                    return Some((symbol, arguments));
                }
            }
        }
        None
    }

    /// Whether `actual` is `pattern` with something for each of `parameters`, which is noted in `arguments`.
    fn unify(
        &self,
        pattern: TypeId,
        actual: TypeId,
        parameters: &[TypeId],
        arguments: &mut [Option<TypeId>],
    ) -> bool {
        if let Some(i) = parameters.iter().position(|&p| p == pattern) {
            return *arguments[i].get_or_insert(actual) == actual;
        }
        if !self.c.has_type_variables(pattern) {
            return pattern == actual;
        }
        match (self.c.data(pattern), self.c.data(actual)) {
            (
                TypeData::Ref {
                    target: a,
                    args: left,
                },
                TypeData::Ref {
                    target: b,
                    args: right,
                },
            ) if a == b && left.len() == right.len() => left
                .iter()
                .zip(right.iter())
                .all(|(&l, &r)| self.unify(l, r, parameters, arguments)),
            _ => false,
        }
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
        let mut seen_names: Vec<(String, Vec<(TypeId, usize)>)> = Vec::new();
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
        if let Some((alias, _)) = self.alias_of_type(ty) {
            return Some(alias);
        }
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => Some(*target),
            TypeData::Union(members) => self.enum_of_members(ty, members),
            TypeData::EnumLit { member, .. } => self.parent_of_symbol(*member),
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

    fn name_of_container(&self, container: Option<(FileId, ScopeId)>) -> String {
        let Some((file, scope)) = container.filter(|container| container.1.is_some()) else {
            return String::new();
        };
        let bound = self.c.bound(file);
        let symbol = match bound.scopes[scope.idx()].kind {
            ScopeKind::Fn(function) => {
                if let FnOwner::Member(member) = bound.fns[function.idx()].owner {
                    let member = &self.c.hir(file)[member];
                    return self.property_key_text(file, member.key, member.pos);
                }
                bound.fn_symbol[function.idx()]
            }
            ScopeKind::Class(class) => bound.class_symbol[class.idx()],
            ScopeKind::Interface(interface) => bound.interface_symbol[interface.idx()],
            _ => SymbolId::NONE,
        };
        if symbol.is_none() {
            return "(Anonymous function)".to_owned();
        }
        self.name_of_symbol_as_written(self.c.files().sym(file, symbol), true)
    }

    /// `typeReferenceToTypeNode`, of a reference to a class or an interface.
    fn type_reference_to_node(&mut self, ty: TypeId, target: Sym, args: &[TypeId]) -> Node {
        if let Some(element) = self.c.array_element(ty) {
            let is_readonly = self.c.global_type_symbol(known::ReadonlyArray) == Some(target);
            let element = self.type_to_node(element);
            let array = format!("{}[]", element.emit(POSTFIX));
            return if is_readonly {
                Node::new(format!("readonly {array}"), TYPE_OPERATOR)
            } else {
                Node::new(array, POSTFIX)
            };
        }
        let outer = self.c.outer_type_params_of_symbol(target);
        let all = self.c.all_type_params_of_symbol(target);
        // The groups of type arguments for the type parameters of what the declaration is inside of. `appendReferenceToType` keeps
        // the names and drops the type arguments of all but the last reference.
        let mut qualifier = String::new();
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
                    qualifier.push_str(&name);
                    qualifier.push('.');
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
            node.text.insert_str(0, &qualifier);
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
                let dots = if flag.intersects(ElemFlags::REST | ElemFlags::VARIADIC) {
                    "..."
                } else {
                    ""
                };
                let question = if flag.contains(ElemFlags::OPTIONAL) {
                    "?"
                } else {
                    ""
                };
                let ty = if flag.contains(ElemFlags::REST) {
                    format!("{}[]", node.emit(POSTFIX))
                } else {
                    node.text
                };
                parts.push(format!("{dots}{}{question}: {ty}", self.text(flag.label())));
                continue;
            }
            parts.push(if flag.contains(ElemFlags::REST) {
                format!("...{}[]", node.emit(POSTFIX))
            } else if flag.contains(ElemFlags::VARIADIC) {
                format!("...{}", node.text)
            } else if flag.contains(ElemFlags::OPTIONAL) {
                format!("{}?", node.emit(POSTFIX))
            } else {
                node.text
            });
        }
        let tuple = format!("[{}]", parts.join(", "));
        if readonly {
            Node::new(format!("readonly {tuple}"), TYPE_OPERATOR)
        } else {
            Node::simple(tuple)
        }
    }

    // ───────────────────────────── type parameters ─────────────────────────────

    fn name_of_type_parameter(&self, parameter: TypeId) -> String {
        match self.c.type_param_name(parameter) {
            Some(name) if name.is_some() => self.text(name),
            _ => "?".to_owned(),
        }
    }

    /// `getInferredTypeParameterConstraint(t, omitTypeReferences = true)`
    fn inferred_constraint_without_references(&mut self, parameter: TypeId) -> Option<TypeId> {
        let TypeData::TypeParam(file, tp, _) = *self.c.data(parameter) else {
            return None;
        };
        let bound = self.c.bound(file);
        let symbol = bound.type_param_symbol[tp.idx()];
        if symbol.is_none() {
            return None;
        }
        let any_key = [TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL];
        let mut inferences = Vec::new();
        for &decl in &bound.symbols[symbol.idx()].decls {
            let Decl::TypeParam(declaration) = decl else {
                continue;
            };
            let Ok(at) = bound
                .infer_positions
                .binary_search_by_key(&declaration, |entry| entry.0)
            else {
                continue;
            };
            match bound.infer_positions[at].1 {
                InferPosition::TypeArgument(..) => {}
                InferPosition::Rest => inferences.push(self.c.array_of(TypeId::UNKNOWN)),
                InferPosition::Template => inferences.push(TypeId::STRING),
                InferPosition::MappedKey => inferences.push(self.c.union(&any_key)),
                InferPosition::MappedTemplate(checked) => {
                    let mapped = self.c.hir(file)[checked];
                    let template = self.c.type_from_node(file, mapped.ty);
                    let key = self.c.type_param(file, mapped.param);
                    let written = self.c.hir(file)[mapped.param].constraint;
                    let over = if written.is_some() {
                        self.c.type_from_node(file, written)
                    } else {
                        self.c.union(&any_key)
                    };
                    let mapper = self.c.mapper_from(&[key], &[over]);
                    inferences.push(self.c.instantiate(template, mapper));
                }
            }
        }
        if inferences.is_empty() {
            None
        } else {
            Some(self.c.intersection(&inferences))
        }
    }

    /// A type parameter where it is used: its name, or `infer T` in the `extends` type that declares it.
    fn type_parameter_to_node(&mut self, ty: TypeId) -> Node {
        let name = self.name_of_type_parameter(ty);
        if !self.infer_type_parameters.contains(&ty) {
            self.approximate_length += 2 * (name.len() + 1);
            return Node {
                text: name.clone(),
                precedence: NON_ARRAY,
                reference: Some(name),
            };
        }
        self.approximate_length += name.len() + 6;
        // A constraint that follows from where `infer T` is written is left out.
        if let Some(constraint) = self.c.constraint_of_type_param(ty) {
            let is_implied = match self.inferred_constraint_without_references(ty) {
                Some(inferred) => self.c.is_identical(constraint, inferred),
                None => false,
            };
            if !is_implied {
                self.approximate_length += 9;
                let constraint = self.type_to_node(constraint);
                return Node::new(
                    format!("infer {name} extends {}", constraint.text),
                    FUNCTION,
                );
            }
        }
        Node::new(format!("infer {name}"), TYPE_OPERATOR)
    }

    /// The constraint of `parameter` in its declaration. `typeToTypeNodeHelperWithPossibleReusableTypeNode`: it is written as it is
    /// declared if that still is what it comes to.
    fn constraint_to_node(&mut self, parameter: TypeId, constraint: TypeId) -> Node {
        if let TypeData::TypeParam(file, tp, _) = *self.c.data(parameter) {
            let written = self.c.hir(file)[tp].constraint;
            if written.is_some() {
                let declared = self.c.type_from_node(file, written);
                if self.c.instantiate(declared, self.mapper) == constraint {
                    let length_before = self.approximate_length;
                    let node = self.type_node_to_node(file, written);
                    // What counts is how long it is in the source, which is not kept of the default library.
                    let length = if self.c.hir(file).text.is_empty() {
                        node.text.len()
                    } else {
                        let start = self.c.hir(file)[written].pos;
                        self.c.end_of_type_node(file, written).saturating_sub(start) as usize
                    };
                    self.approximate_length = length_before + length + 1;
                    return node;
                }
            }
        }
        self.type_to_node(constraint)
    }

    /// `typeParameterToDeclaration`
    fn type_parameter_declaration(&mut self, parameter: TypeId) -> String {
        let constraint = match self.c.constraint_of_type_param(parameter) {
            Some(constraint) => Some(self.constraint_to_node(parameter, constraint).text),
            None => None,
        };
        let mut text = String::new();
        if let Some((_, declaration)) = self.c.type_param_decl(parameter) {
            for (flag, modifier) in [
                (Flags::CONST, "const "),
                (Flags::IN, "in "),
                (Flags::OUT, "out "),
            ] {
                if declaration.flags.contains(flag) {
                    text.push_str(modifier);
                }
            }
        }
        text.push_str(&self.name_of_type_parameter(parameter));
        if let Some(constraint) = constraint {
            text.push_str(" extends ");
            text.push_str(&constraint);
        }
        if let Some(default) = self.c.default_of_type_param(parameter) {
            let default = self.type_to_node(default);
            text.push_str(" = ");
            text.push_str(&default.text);
        }
        text
    }

    // ───────────────────────────── unions and intersections ─────────────────────────────

    fn union_to_node(&mut self, ty: TypeId) -> Node {
        // `UnionType.origin`: `keyof T`.
        if let Some(&of) = self.c.keyof_origins.get(&ty) {
            self.approximate_length += 6;
            let of = self.type_to_node(of);
            return Node::new(format!("keyof {}", of.emit(TYPE_OPERATOR)), TYPE_OPERATOR);
        }
        // `UnionType.origin`: the intersection it was distributed from.
        if let Some(origin) = self.c.p.union_origins.get(&ty) {
            return self.intersection_to_node(&origin);
        }
        let types = self.format_union_types(ty);
        if let [only] = types[..] {
            return self.type_to_node(only);
        }
        let nodes = self.map_to_type_nodes(&types, true);
        Node::new(join_nodes(nodes, " | ", TYPE_OPERATOR), UNION)
    }

    fn intersection_to_node(&mut self, members: &[TypeId]) -> Node {
        if let [only] = members[..] {
            return self.type_to_node(only);
        }
        let nodes = self.map_to_type_nodes(members, true);
        Node::new(join_nodes(nodes, " & ", TYPE_OPERATOR), INTERSECTION)
    }

    /// `formatUnionTypes`, of the members of `ty` in the order TypeScript keeps them in.
    fn format_union_types(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut types = self.sorted_members(ty);
        // `T | undefined`, of a `T` that is a union with a name (`UnionType.origin`). One of `null` and `undefined` may be part of what
        // has the name.
        for (without_undefined, without_null) in [(false, true), (true, false), (true, true)] {
            let is_apart = |member: TypeId| {
                without_undefined && member.is_undefined() || without_null && member.is_null()
            };
            let rest = self.c.filter(ty, |_, member| !is_apart(member));
            if rest != ty
                && rest != TypeId::BOOLEAN
                && self.c.is_union(rest)
                && self.alias_of_type(rest).is_some()
            {
                types.retain(|&member| is_apart(member));
                types.insert(0, rest);
                break;
            }
        }
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
                let all = self.sorted_members(base);
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

    /// The members of the union `ty`, which are stored by id, in the order of `CompareTypes`.
    fn sorted_members(&mut self, ty: TypeId) -> Vec<TypeId> {
        let parts = self.c.parts(ty);
        if parts.len() < 2 {
            return parts.to_vec();
        }
        let mut sorted: Vec<SortKey> = Vec::with_capacity(parts.len());
        for &part in parts {
            let key = self.sort_key(part);
            let (mut low, mut high) = (0, sorted.len());
            while low < high {
                let middle = (low + high) / 2;
                if self.compare_keys(&sorted[middle], &key).is_lt() {
                    low = middle + 1;
                } else {
                    high = middle;
                }
            }
            sorted.insert(low, key);
        }
        sorted.into_iter().map(|key| key.ty).collect()
    }

    /// `getSortOrderFlags`, with the values of `TypeFlags`.
    fn sort_order_flags(&self, ty: TypeId) -> u32 {
        match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Unresolved | Intrinsic::Any => 1 << 0,
                Intrinsic::Unknown => 1 << 1,
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => 1 << 2,
                Intrinsic::Null | Intrinsic::NullDeclared => 1 << 3,
                Intrinsic::Void => 1 << 4,
                Intrinsic::String => 1 << 5,
                Intrinsic::Number => 1 << 6,
                Intrinsic::BigInt => 1 << 7,
                Intrinsic::Symbol => 1 << 9,
                Intrinsic::Object => 1 << 17,
                Intrinsic::Never => 1 << 18,
            },
            TypeData::StringLit { .. } => 1 << 10,
            TypeData::NumberLit { .. } => 1 << 11,
            TypeData::BigIntLit { .. } => 1 << 12,
            TypeData::BoolLit { .. } => 1 << 13,
            TypeData::UniqueSymbol { .. } => 1 << 14,
            TypeData::EnumLit { .. } | TypeData::Enum { .. } => 1 << 16,
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => 1 << 19,
            TypeData::Keyof(_) => 1 << 21,
            TypeData::Template { .. } => 1 << 22,
            TypeData::StringMapping { .. } => 1 << 23,
            TypeData::NoInfer(_) => 1 << 24,
            TypeData::IndexedAccess { .. } => 1 << 25,
            TypeData::Cond { .. } => 1 << 26,
            TypeData::Union(_) if ty == TypeId::BOOLEAN => 1 << 27 | 1 << 8,
            TypeData::Union(_) => 1 << 27,
            TypeData::Intersection(_) => 1 << 28,
            _ => 1 << 20,
        }
    }

    fn sort_key(&mut self, ty: TypeId) -> SortKey {
        let alias = self.alias_of_type(ty);
        let files = self.c.files();
        let name_of = |symbol: Sym| {
            let name = files.symbol(symbol).name;
            if name.is_none() {
                // `InternalSymbolNameClass`
                b"\xFEclass".to_vec()
            } else {
                files.atoms.bytes(name).to_vec()
            }
        };
        // `getTypeNameSymbol`
        let name = match (&alias, self.c.data(ty)) {
            (Some((symbol, _)), _) => Some(name_of(*symbol)),
            (None, TypeData::Ref { target: symbol, .. } | TypeData::ThisParam(symbol)) => {
                Some(name_of(*symbol))
            }
            (None, TypeData::TypeParam(..)) => Some(self.name_of_type_parameter(ty).into_bytes()),
            (None, TypeData::StringMapping { kind, .. }) => {
                Some(string_mapping_name(*kind).as_bytes().to_vec())
            }
            _ => None,
        };
        SortKey {
            ty,
            flags: self.sort_order_flags(ty),
            name,
            alias,
        }
    }

    /// What `ty` is an instantiation of, and with what.
    fn instantiation_of(&self, ty: TypeId) -> Option<(Identity, MapperId)> {
        match self.c.data(ty) {
            TypeData::Anon { origin, mapper } => Some((Identity::Origin(*origin), *mapper)),
            TypeData::Fns { decls, mapper } => decls
                .first()
                .map(|&(file, func)| (Identity::Function(file, func), *mapper)),
            TypeData::Cond { file, node, mapper } => {
                Some((Identity::Conditional(*file, *node), *mapper))
            }
            _ => None,
        }
    }

    /// What `mapper` puts for the type parameters it is about, in the order they are declared.
    fn mapper_targets(&self, mapper: MapperId) -> Vec<TypeId> {
        let mut pairs = self.c.p.types.mapping(mapper).to_vec();
        pairs.sort_by_key(|pair| match *self.c.data(pair.0) {
            TypeData::TypeParam(file, tp, _) => (0u8, file.0, tp.0),
            _ => (1, 0, pair.0.0),
        });
        pairs.into_iter().map(|pair| pair.1).collect()
    }

    /// `compareTypeLists`
    fn compare_type_lists(&mut self, left: &[TypeId], right: &[TypeId]) -> std::cmp::Ordering {
        let by_length = left.len().cmp(&right.len());
        if by_length.is_ne() {
            return by_length;
        }
        for (&a, &b) in left.iter().zip(right) {
            let order = self.compare_types(a, b);
            if order.is_ne() {
                return order;
            }
        }
        std::cmp::Ordering::Equal
    }

    /// `CompareTypes`
    fn compare_types(&mut self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        if a == b {
            return std::cmp::Ordering::Equal;
        }
        if self.comparison_depth >= 8 {
            return self.c.compare_types(a, b);
        }
        self.comparison_depth += 1;
        let (left, right) = (self.sort_key(a), self.sort_key(b));
        let order = self.compare_keys(&left, &right);
        self.comparison_depth -= 1;
        order
    }

    /// `Checker::compare_types` knows nothing of aliases, and does not compare mappers: that comes first here.
    fn compare_keys(&mut self, a: &SortKey, b: &SortKey) -> std::cmp::Ordering {
        use std::cmp::Ordering::{Equal, Greater, Less};
        if a.ty == b.ty {
            return Equal;
        }
        let by_flags = a.flags.cmp(&b.flags);
        if by_flags.is_ne() {
            return by_flags;
        }
        // `compareTypeNames`
        let by_name = match (&a.name, &b.name) {
            (Some(x), Some(y)) => x.cmp(y),
            (Some(_), None) => Less,
            (None, Some(_)) => Greater,
            (None, None) => Equal,
        };
        if by_name.is_ne() {
            return by_name;
        }
        let mut lists: Option<(Vec<TypeId>, Vec<TypeId>)> = None;
        if let (Some((x, left)), Some((y, right))) = (&a.alias, &b.alias) {
            if x == y {
                lists = Some((left.clone(), right.clone()));
            }
        } else if let (
            TypeData::Ref {
                target: x,
                args: left,
            },
            TypeData::Ref {
                target: y,
                args: right,
            },
        ) = (self.c.data(a.ty), self.c.data(b.ty))
        {
            if x == y {
                lists = Some((left.to_vec(), right.to_vec()));
            }
        } else if let (Some((x, left)), Some((y, right))) =
            (self.instantiation_of(a.ty), self.instantiation_of(b.ty))
            && x == y
        {
            lists = Some((self.mapper_targets(left), self.mapper_targets(right)));
        }
        if let Some((left, right)) = lists {
            let by_arguments = self.compare_type_lists(&left, &right);
            if by_arguments.is_ne() {
                return by_arguments;
            }
        }
        self.c.compare_types(a.ty, b.ty)
    }

    // ───────────────────────────── anonymous object types ─────────────────────────────

    /// `getBaseTypeVariableOfClass(symbol) != nil`
    fn extends_type_variable(&mut self, class: Sym) -> bool {
        for (file, decl) in self.c.files().decls(class) {
            let Decl::Class(declaration) = decl else {
                continue;
            };
            let extends = self.c.hir(file)[declaration].extends;
            if extends.is_none() {
                continue;
            }
            let base = self.c.type_of_expr(file, extends);
            return match self.c.data(base) {
                TypeData::Intersection(parts) => {
                    parts.iter().any(|&part| self.c.is_type_variable(part))
                }
                _ => self.c.is_type_variable(base),
            };
        }
        false
    }

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
        let flags = self.c.files().flags(symbol);
        if flags.contains(SymFlags::CLASS) && !self.extends_type_variable(symbol)
            || flags.intersects(SymFlags::ENUM | SymFlags::VALUE_MODULE)
        {
            return Some(symbol);
        }
        // `shouldWriteTypeOfFunctionSymbol`: a function whose type refers to itself.
        (flags.contains(SymFlags::FUNCTION)
            && self.visited_types.contains(&ty)
            && self.is_non_local_function(symbol))
        .then_some(symbol)
    }

    /// The same for a function expression that initializes a variable at the top of a file or a namespace: the name of the variable.
    fn variable_of_function_expression(&self, ty: TypeId) -> Option<String> {
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
        match hir[hir[declaration].pat].kind {
            PatKind::Ident(name) => Some(self.text(name)),
            _ => None,
        }
    }

    /// `isStaticMethodSymbol`: the name of the static method `ty` is the type of.
    fn name_of_static_method(&self, ty: TypeId) -> Option<String> {
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

    /// `createAnonymousTypeNode`
    fn anonymous_type_to_node(&mut self, ty: TypeId) -> Node {
        let identity = match self.c.data(ty) {
            TypeData::Anon { origin, .. } => {
                let origin = *origin;
                if origin == Origin::GlobalThis {
                    self.approximate_length += 2 * ("globalThis".len() + 1);
                    return Node::new("typeof globalThis", TYPE_OPERATOR);
                }
                if let Some(symbol) = self.symbol_to_query(ty, origin) {
                    return self.symbol_to_type_node(symbol, true, Vec::new());
                }
                Identity::Origin(origin)
            }
            TypeData::Fns { decls, .. } => match decls.first() {
                Some(&(file, func)) => Identity::Function(file, func),
                None => Identity::Type(ty),
            },
            _ => Identity::Type(ty),
        };
        if self.visited_types.contains(&ty) {
            if let Some(name) = self
                .variable_of_function_expression(ty)
                .or_else(|| self.name_of_static_method(ty))
            {
                self.approximate_length += 2 * (name.len() + 1);
                return Node::new(format!("typeof {name}"), TYPE_OPERATOR);
            }
            return self.elided_information_placeholder();
        }
        let Some(depth) = self.enter_type(ty, Some(identity)) else {
            return self.elided_information_placeholder();
        };
        let node = self.object_type_to_node(ty);
        self.leave_type(ty, Some(identity), depth);
        node
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
            return Node::simple("{}");
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
                    return Node::simple("{}");
                }
                ([only], []) => return self.signature_to_node(*only, SignatureKind::FunctionType),
                ([], [only]) => {
                    return self.signature_to_node(*only, SignatureKind::ConstructorType);
                }
                _ => {}
            }
        }
        let properties = match *self.c.data(ty) {
            TypeData::ReverseMapped { source, .. } => {
                self.properties_ordered_as_in(source, &shape.props)
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
        // `abstract new () => T` cannot be written in a type literal: it is intersected with the rest.
        let mut nodes = Vec::with_capacity(abstract_signatures.len() + 1);
        for signature in abstract_signatures {
            self.approximate_length += 2;
            nodes.push(self.signature_to_node(signature, SignatureKind::ConstructorType));
        }
        if call.len() + construct.len() + shape.index.len() + properties.len() != 0 {
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
        Node::new(join_nodes(nodes, " & ", TYPE_OPERATOR), INTERSECTION)
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
        let elements = self.type_elements(ty, call, construct, index, properties, mapper);
        self.approximate_length += 2;
        if elements.is_empty() {
            Node::simple("{}")
        } else {
            Node::simple(format!("{{ {} }}", elements.join(" ")))
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
    ) -> Vec<String> {
        let no_truncation = self.flags & NO_TRUNCATION != 0;
        if self.check_truncation_length() {
            return if no_truncation {
                Vec::new()
            } else {
                vec!["...;".to_owned()]
            };
        }
        let mut elements = Vec::new();
        for &signature in call {
            let text = self.signature_to_text(signature, SignatureKind::Call, "", false);
            elements.push(format!("{text};"));
        }
        for &signature in construct {
            let text = self.signature_to_text(signature, SignatureKind::Construct, "", false);
            elements.push(format!("{text};"));
        }
        let is_reverse_mapped = matches!(self.c.data(ty), TypeData::ReverseMapped { .. });
        for info in index {
            // The placeholder is made whether or not it is used.
            let placeholder = self.elided_information_placeholder();
            let name = self.index_parameter_name(ty, info.key);
            let key = self.c.instantiate(info.key, mapper);
            let key = self.type_to_node(key);
            let value = if is_reverse_mapped {
                placeholder
            } else {
                let value = self.c.instantiate(info.value, mapper);
                self.type_to_node(value)
            };
            self.approximate_length += name.len() + 4;
            let modifier = if info.readonly {
                self.approximate_length += 9;
                "readonly "
            } else {
                ""
            };
            elements.push(format!("{modifier}[{name}: {}]: {};", key.text, value.text));
        }
        for (i, property) in properties.iter().enumerate() {
            if self.check_truncation_length() && i + 1 + 2 < properties.len() - 1 {
                if !no_truncation {
                    elements.push(format!("... {} more ...;", properties.len() - (i + 1)));
                }
                let last = &properties[properties.len() - 1];
                self.add_property_to_element_list(ty, last, mapper, &mut elements);
                break;
            }
            self.add_property_to_element_list(ty, property, mapper, &mut elements);
        }
        elements
    }

    /// `getNameFromIndexInfo`: the name of the parameter of the index signature of `owner` for `key`, where it is declared.
    fn index_parameter_name(&mut self, owner: TypeId, key: TypeId) -> String {
        if let TypeData::Anon {
            origin: Origin::TypeLiteral(file, node),
            ..
        } = *self.c.data(owner)
            && let TypeNodeKind::Object(members) = self.c.hir(file)[node].kind
        {
            let hir = self.c.hir(file);
            for m in members.iter() {
                let member = &hir[m];
                if member.kind != MemberKind::IndexSignature || member.func.is_none() {
                    continue;
                }
                let parameters = hir[member.func].params;
                if parameters.len() != 1 {
                    continue;
                }
                let parameter = &hir[parameters.at(0)];
                let PatKind::Ident(name) = hir[parameter.pat].kind else {
                    continue;
                };
                let keys = self.c.type_from_node(file, parameter.ty);
                let keys = self.c.force(keys);
                if self.c.parts(keys).contains(&key) {
                    return self.text(name);
                }
            }
        }
        "x".to_owned()
    }

    // ───────────────────────────── properties ─────────────────────────────

    /// `syntheticOrigin`: the property of the type a mapped type takes its modifiers from that the property `name` of `of` has its
    /// declarations from. With an `as` clause that renames it has none.
    fn origin_of_mapped_property(&mut self, of: TypeId, name: Atom) -> Option<Prop> {
        let (file, node, mapper) = self.c.mapped_origin(of)?;
        let mapped = self.c.mapped_decl(file, node);
        if self.c.hir(file)[mapped.param].constraint.is_none() {
            return None;
        }
        // `MappedTypeNameTypeKindRemapping`
        if let Some(renamed) = self.c.mapped_name_type(of) {
            let key = self.c.mapped_type_param(of);
            if !self.c.is_assignable(renamed, key) {
                return None;
            }
        }
        let (declared, _) = self.c.mapped_modifiers_source(file, node)?;
        let modifiers = self.c.instantiate(declared, mapper);
        let modifiers = self.c.apparent_type(modifiers);
        self.c.prop_of(modifiers, name).map(|found| found.0)
    }

    fn place_of_symbol(&self, symbol: Sym) -> Place {
        let files = self.c.files();
        let Some((file, decl)) = files.decls(symbol).first().copied() else {
            return Place::Nowhere;
        };
        let hir = self.c.hir(file);
        let pos = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => hir[pat].pos,
            Decl::Fn(function) => hir[function].pos,
            Decl::Class(class) => hir[class].pos,
            Decl::Interface(interface) => hir[interface].name_pos,
            Decl::Alias(alias) => hir[alias].name_pos,
            Decl::Enum(enumeration) => hir[enumeration].name_pos,
            Decl::EnumMember(member) => hir[member].pos,
            Decl::Module(module) => hir[module].name_pos,
            Decl::ImportDefault(import) => hir[import].default_pos,
            Decl::ImportNamespace(import) => hir[import].namespace_pos,
            Decl::ImportSpec(specifier) => hir[specifier].pos,
            Decl::ImportEquals(import) => hir[import].name_pos,
            Decl::ExportSpec(specifier) => hir[specifier].pos,
            Decl::ExportStarAs(statement)
            | Decl::ExportExpr(statement)
            | Decl::UmdGlobal(statement) => hir[statement].pos,
            Decl::ModuleExports(e) | Decl::ExportsProperty(e) => hir[e].pos,
            _ => 0,
        };
        Place::At((!files.module(file).is_lib, file.0, pos))
    }

    /// Where the first declaration of `prop` is.
    fn place_of_property(&mut self, prop: &Prop, depth: u32) -> Place {
        let at = |c: &Checker<'p>, file: FileId, pos: u32| {
            Place::At((!c.files().module(file).is_lib, file.0, pos))
        };
        match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, member)) => at(&*self.c, file, self.c.hir(file)[member].pos),
                None => Place::Nowhere,
            },
            PropSource::Parameter(file, parameter) => {
                at(&*self.c, *file, self.c.hir(*file)[*parameter].pos)
            }
            PropSource::Literal(file, written) => {
                at(&*self.c, *file, self.c.hir(*file)[*written].pos)
            }
            PropSource::Symbol(symbol) => self.place_of_symbol(*symbol),
            PropSource::Assigned(file, list) => match list.first() {
                Some(&first) => at(&*self.c, *file, self.c.hir(*file)[first].pos),
                None => Place::Nowhere,
            },
            PropSource::Intersected(_, parts) if depth < 8 => match parts.first() {
                Some(first) => self.place_of_property(first, depth + 1),
                None => Place::Nowhere,
            },
            PropSource::Mapped(of, _) if depth < 8 => {
                match self.origin_of_mapped_property(*of, prop.name) {
                    Some(origin) => self.place_of_property(&origin, depth + 1),
                    None => Place::Nowhere,
                }
            }
            _ => Place::Unknown,
        }
    }

    /// `getNamedMembers` sorts with `compareSymbols`: by where the first declaration is, and what has none last, by name. Where a
    /// property may have a declaration that is not kept, the order is left as it is.
    fn ordered_properties(&mut self, props: &[Prop]) -> Vec<Prop> {
        let mut keyed: Vec<((u8, (bool, u32, u32), &'p [u8]), &Prop)> =
            Vec::with_capacity(props.len());
        for prop in props {
            let name = self.c.files().atoms.bytes(prop.name);
            keyed.push(match self.place_of_property(prop, 0) {
                Place::At(place) => ((0, place, name), prop),
                Place::Nowhere => ((1, (false, 0, 0), name), prop),
                Place::Unknown => return props.to_vec(),
            });
        }
        keyed.sort_by(|a, b| a.0.cmp(&b.0));
        keyed.into_iter().map(|entry| entry.1.clone()).collect()
    }

    /// `resolveReverseMappedTypeMembers`: each of `props` has the declarations of the property of `source` it is made from, and is
    /// ordered by those.
    fn properties_ordered_as_in(&mut self, source: TypeId, props: &[Prop]) -> Vec<Prop> {
        let Some(members) = self.c.members(source) else {
            return props.to_vec();
        };
        let ordered: Vec<Prop> = self
            .ordered_properties(&members.shape().props)
            .iter()
            .filter_map(|of| props.iter().find(|prop| prop.name == of.name).cloned())
            .collect();
        if ordered.len() == props.len() {
            ordered
        } else {
            props.to_vec()
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
                        is_single_quoted: hir.text.get(member.pos as usize) == Some(&b'\''),
                        is_computed,
                    });
                }
            }
            PropSource::Literal(file, written) => {
                let hir = self.c.hir(*file);
                let written = &hir[*written];
                let at = written.pos as usize;
                let first = hir.text.get(at).copied();
                // In an object literal every name in brackets gives the property a `nameType`.
                let in_brackets = first == Some(b'[');
                let is_string = match written.key {
                    PropKey::Computed(e) => {
                        let key = self.c.type_of_expr(*file, e);
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
                out.push(WrittenName {
                    is_string,
                    is_single_quoted: first == Some(b'\''),
                    is_computed: in_brackets || matches!(written.key, PropKey::Computed(_)),
                });
            }
            PropSource::Parameter(..) | PropSource::Symbol(_) => out.push(plain),
            PropSource::Assigned(file, list) => {
                let hir = self.c.hir(*file);
                for &declaration in list.iter() {
                    let is_string = match hir[declaration].kind {
                        ExprKind::Assign { target, .. } => match hir[target].kind {
                            ExprKind::Index { index, .. } => {
                                matches!(hir[index].kind, ExprKind::String(_))
                            }
                            _ => false,
                        },
                        _ => false,
                    };
                    out.push(WrittenName { is_string, ..plain });
                }
            }
            PropSource::Intersected(_, parts) if depth < 8 => {
                for part in parts.iter() {
                    self.written_names(part, depth + 1, out);
                }
            }
            PropSource::Mapped(of, _) if depth < 8 => {
                if let Some(origin) = self.origin_of_mapped_property(*of, prop.name) {
                    self.written_names(&origin, depth + 1, out);
                }
            }
            _ => {}
        }
    }

    /// The expression in the brackets of the first declaration of `prop`, if it is written `a` or `a.b.c`.
    fn computed_key_text(&mut self, prop: &Prop, depth: u32) -> Option<String> {
        let (file, key) = match &prop.source {
            PropSource::Members(list) => {
                let &(file, member) = list.first()?;
                (file, self.c.hir(file)[member].key)
            }
            PropSource::Literal(file, written) => (*file, self.c.hir(*file)[*written].key),
            PropSource::Intersected(_, parts) if depth < 8 => {
                return self.computed_key_text(parts.first()?, depth + 1);
            }
            PropSource::Mapped(of, _) if depth < 8 => {
                let origin = self.origin_of_mapped_property(*of, prop.name)?;
                return self.computed_key_text(&origin, depth + 1);
            }
            _ => return None,
        };
        match key {
            PropKey::Computed(e) => self.entity_name_text(file, e),
            _ => None,
        }
    }

    /// `getPropertyNameNodeForSymbol`
    fn property_name(&mut self, prop: &Prop) -> String {
        let bytes = self.c.files().atoms.bytes(prop.name);
        if bytes.first() == Some(&b'#') {
            return String::from_utf8_lossy(self.c.written_name(prop.name)).into_owned();
        }
        // The `nameType` is a `unique symbol`: `symbolToExpression`, seen from where the property is declared.
        if let Some(symbol) = bytes.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) {
            let end = symbol
                .iter()
                .position(|&b| b == b'@')
                .unwrap_or(symbol.len());
            let name = String::from_utf8_lossy(&symbol[..end]);
            let expression = match self.computed_key_text(prop, 0) {
                Some(written) => written,
                None if end == symbol.len() => format!("Symbol.{name}"),
                None => name.into_owned(),
            };
            self.approximate_length += expression.len() + 1;
            return format!("[{expression}]");
        }
        let name = String::from_utf8_lossy(bytes).into_owned();
        let mut written = Vec::new();
        self.written_names(prop, 0, &mut written);
        let is_string_named = !written.is_empty() && written.iter().all(|w| w.is_string);
        let quote = if !written.is_empty() && written.iter().all(|w| w.is_single_quoted) {
            '\''
        } else {
            '"'
        };
        let has_name_type = matches!(prop.source, PropSource::Mapped(..))
            || written.first().is_some_and(|w| w.is_computed);
        let is_identifier = is_identifier_text(&name);
        let is_numeric = self.c.is_numeric_name(prop.name);
        // `getPropertyNameNodeForSymbolFromNameType`
        if has_name_type
            && !is_identifier
            && is_numeric
            && !is_string_named
            && name.starts_with('-')
        {
            return format!("[{name}]");
        }
        // `classifyPropertyName`
        let is_new_method = prop.flags.contains(PropFlags::METHOD) && name == "new";
        if !is_new_method
            && (is_identifier || !is_string_named && is_numeric && !name.starts_with('-'))
        {
            return name;
        }
        quoted(&name, quote, true)
    }

    /// `getNameOfSymbolFromNameType`, going by the name alone.
    fn name_from_name_type(&self, name: Atom) -> String {
        let bytes = self.c.files().atoms.bytes(name);
        if bytes.first() == Some(&b'#') {
            return String::from_utf8_lossy(self.c.written_name(name)).into_owned();
        }
        if let Some(symbol) = bytes.strip_prefix(crate::atom::SYMBOL_NAME_PREFIX) {
            let end = symbol
                .iter()
                .position(|&b| b == b'@')
                .unwrap_or(symbol.len());
            return format!("[{}]", String::from_utf8_lossy(&symbol[..end]));
        }
        let text = String::from_utf8_lossy(bytes).into_owned();
        let is_numeric = self.c.is_numeric_name(name);
        if !is_identifier_text(&text) && !is_numeric {
            return quoted(&text, '"', false);
        }
        if is_numeric && text.starts_with('-') {
            return format!("[{text}]");
        }
        text
    }

    /// `getNameOfSymbolAsWritten`, of a property: its name as its first declaration writes it.
    fn name_of_property_as_written(&mut self, prop: &Prop, depth: u32) -> String {
        match &prop.source {
            PropSource::Members(list) => {
                if let Some(&(file, member)) = list.first() {
                    let member = &self.c.hir(file)[member];
                    return self.property_key_text(file, member.key, member.pos);
                }
            }
            PropSource::Parameter(file, parameter) => {
                let pat = self.c.hir(*file)[*parameter].pat;
                return self.binding_name_text(*file, pat);
            }
            PropSource::Literal(file, written) => {
                let written = &self.c.hir(*file)[*written];
                return self.property_key_text(*file, written.key, written.pos);
            }
            PropSource::Symbol(symbol) => return self.symbol_to_text(*symbol),
            PropSource::Type(_) => {
                if let Some((file, member)) = self.c.first_declaration_of_overloads(prop) {
                    let member = &self.c.hir(file)[member];
                    return self.property_key_text(file, member.key, member.pos);
                }
            }
            PropSource::Assigned(file, list) => {
                let hir = self.c.hir(*file);
                if let Some(&first) = list.first()
                    && let ExprKind::Assign { target, .. } = hir[first].kind
                    && let ExprKind::Index { index, .. } = hir[target].kind
                    && let Some(text) = self.written_literal_name(*file, hir[index].pos, false)
                {
                    return text;
                }
            }
            PropSource::Intersected(_, parts) if depth < 8 => {
                if let Some(first) = parts.first() {
                    return self.name_of_property_as_written(first, depth + 1);
                }
            }
            PropSource::Mapped(of, _) if depth < 8 => {
                if let Some(origin) = self.origin_of_mapped_property(*of, prop.name) {
                    return self.name_of_property_as_written(&origin, depth + 1);
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
    fn name_of_setter_parameter(&mut self, prop: &Prop) -> String {
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
        "value".to_owned()
    }

    /// `addPropertyToElementList`
    fn add_property_to_element_list(
        &mut self,
        owner: TypeId,
        prop: &Prop,
        mapper: MapperId,
        elements: &mut Vec<String>,
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
            let ty = self.c.type_of_prop_for_inference(prop, mapper);
            self.c.remove_missing_type(ty, is_optional)
        };
        let name = self.property_name(prop);
        self.approximate_length += self.c.written_name(prop.name).len() + 1;
        if prop.flags.contains(PropFlags::ACCESSOR) && self.c.is_known(property_type) {
            let write_type = self.c.write_type_of_prop(prop, mapper);
            let (in_class, is_field) = self.accessor_declaration(prop);
            if self.c.is_known(write_type) && (property_type != write_type || in_class) {
                if is_field || !prop.flags.contains(PropFlags::WRITE_ONLY) {
                    self.approximate_length += 3;
                    let node = self.type_to_node(property_type);
                    elements.push(format!("get {name}(): {};", node.text));
                }
                if is_field || !is_readonly {
                    self.approximate_length += 3;
                    let parameter = if is_field {
                        "arg".to_owned()
                    } else {
                        self.name_of_setter_parameter(prop)
                    };
                    let node = self.type_to_node(write_type);
                    self.approximate_length += parameter.len() + 3;
                    elements.push(format!("set {name}({parameter}: {});", node.text));
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
                    elements.push(format!("{text};"));
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
            let node = self.type_to_node(property_type);
            if reverse_mapped.is_some() {
                self.reverse_mapped_stack.pop();
            }
            node
        };
        let modifier = if is_readonly {
            self.approximate_length += 9;
            "readonly "
        } else {
            ""
        };
        let question = if is_optional { "?" } else { "" };
        elements.push(format!("{modifier}{name}{question}: {};", node.text));
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// `cloneBindingName`: a name or a pattern as it is written, on one line and without initializers.
    fn binding_name_text(&self, file: FileId, pat: PatId) -> String {
        if pat.is_none() {
            return String::new();
        }
        let hir = self.c.hir(file);
        match hir[pat].kind {
            PatKind::Missing => String::new(),
            PatKind::Ident(name) => self.text(name),
            PatKind::Object(props) => {
                let mut parts = Vec::with_capacity(props.len());
                for p in props.iter() {
                    let prop = &hir[p];
                    let value = self.binding_name_text(file, prop.value);
                    parts.push(if prop.is_rest {
                        format!("...{value}")
                    } else if prop.value.is_some() && hir[prop.value].pos == prop.pos {
                        value
                    } else {
                        format!(
                            "{}: {value}",
                            self.property_key_text(file, prop.key, prop.pos)
                        )
                    });
                }
                if parts.is_empty() {
                    "{}".to_owned()
                } else {
                    format!("{{ {} }}", parts.join(", "))
                }
            }
            PatKind::Array(elems) => {
                let mut parts = Vec::with_capacity(elems.len());
                for e in elems.iter() {
                    let name = self.binding_name_text(file, hir[e].pat);
                    parts.push(if hir[e].is_rest {
                        format!("...{name}")
                    } else {
                        name
                    });
                }
                format!("[{}]", parts.join(", "))
            }
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
                        format!("arg{i}")
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
        // `getImmediatelyInvokedFunctionExpression`: how many arguments a function called where it is written is called with.
        let given = match bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    ExprKind::Call(call) if hir[call].callee == e => Some(hir[call].args.len()),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
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
            let mut declared = self.c.type_of_param(file, p);
            if parameter.ty.is_some() {
                let written = self.c.type_from_node(file, parameter.ty);
                if self.c.is_no_infer(written) {
                    declared = self.c.no_infer(declared);
                }
            }
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
                    is_left_out(i, parameter)
                };
            let mut ty = types[i];
            // `requiresAddingImplicitUndefined`: one with an initializer that cannot be left out can be given `undefined`.
            if strict
                && !optional
                && parameter.default.is_some()
                && !parameter.flags.contains(Flags::PARAMETER_PROPERTY)
            {
                let written = self.c.type_from_node(file, parameter.ty);
                let says_undefined = parameter.ty.is_some()
                    && (!self.c.is_known(written) || self.c.contains_undefined(written));
                if !says_undefined {
                    ty = self.c.optional(ty);
                }
            }
            let name = self.binding_name_text(file, parameter.pat);
            let name_length = match hir[parameter.pat].kind {
                PatKind::Ident(_) => name.len(),
                // A pattern is bound as `__0`.
                _ => 2 + i.to_string().len(),
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
    ) -> String {
        let hir = self.c.hir(file);
        let is_variable = flags.intersects(ElemFlags::REST | ElemFlags::VARIADIC);
        match hir[pat].kind {
            PatKind::Ident(name) => {
                let name = self.text(name);
                return match (has_dot_dot_dot, is_variable) {
                    (true, true) | (false, false) => name,
                    (true, false) => format!("{name}_{index}"),
                    (false, true) => format!("{name}_n"),
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
        format!("arg_{index}")
    }

    /// `getTupleElementLabel`, of element `index` of the `arity` elements of the tuple the rest parameter `rest` is. One without a
    /// label of its own is read off the type of the parameter if that is written as a tuple of as many elements.
    fn tuple_element_label(
        &self,
        rest: &Parameter,
        index: usize,
        arity: usize,
        flags: ElemFlags,
    ) -> String {
        if flags.label().is_some() {
            return self.text(flags.label());
        }
        let Some((file, parameter)) = rest.declaration else {
            return format!("{}_{index}", rest.name);
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
        let TypeData::Tuple { elems, flags, .. } = self.c.data(rest.ty) else {
            return parameters.to_vec();
        };
        let mut names: Vec<String> = (0..elems.len())
            .map(|i| self.tuple_element_label(rest, i, elems.len(), flags[i]))
            .collect();
        // `getUniqAssociatedNamesFromTupleType`
        let mut unique: Vec<String> = Vec::with_capacity(names.len());
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
                let name = format!("{}_{counter}", names[i]);
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

    /// `serializeTypeForDeclaration`, `pseudoTypeEquivalentToType`: the annotation of `parameter`, if there is an enclosing
    /// declaration and the annotation still is what the parameter comes to.
    fn annotation_to_reuse(&mut self, parameter: &Parameter) -> Option<(FileId, TypeNodeId)> {
        if self.flags & REUSES_TYPE_NODES == 0 {
            return None;
        }
        let (file, declaration) = parameter.declaration?;
        let written = self.c.hir(file)[declaration].ty;
        if written.is_none() {
            return None;
        }
        let declared = self.c.type_from_node(file, written);
        let declared = self.c.instantiate(declared, self.mapper);
        let is_equivalent = declared == parameter.ty
            || parameter.optional && declared == self.c.without_undefined(parameter.ty);
        is_equivalent.then_some((file, written))
    }

    /// `symbolToParameterDeclaration`
    fn parameter_text(&mut self, parameter: &Parameter) -> String {
        let node = match self.annotation_to_reuse(parameter) {
            Some((file, written)) => self.type_node_to_node(file, written),
            None => self.type_to_node(parameter.ty),
        };
        self.approximate_length += parameter.name_length + 3;
        let text = self
            .library_alias_of_parameter(parameter)
            .unwrap_or(node.text);
        format!(
            "{}{}{}: {}",
            if parameter.rest { "..." } else { "" },
            parameter.name,
            if parameter.optional { "?" } else { "" },
            text
        )
    }

    /// `Type.alias`: a union that is got at through an alias goes by its name. `plain_alias_of` leaves out the aliases of the default
    /// library, whose unions are written out all over. Of a parameter declared there as such an alias and nothing else it is known.
    fn library_alias_of_parameter(&mut self, parameter: &Parameter) -> Option<String> {
        let (file, declaration) = parameter.declaration?;
        let hir = self.c.hir(file);
        let written = hir[declaration].ty;
        if written.is_none()
            || !self.c.files().modules[file.idx()].is_lib
            || !self.c.is_union(parameter.ty)
        {
            return None;
        }
        let TypeNodeKind::Ref { name, args } = hir[written].kind else {
            return None;
        };
        if name.len() != 1 || !args.is_empty() {
            return None;
        }
        let name = hir.id_at(name, 0);
        let alias = self.c.global_type_symbol(name)?;
        let (declared_in, body) = self.body_of_alias(alias)?;
        if !matches!(self.c.hir(declared_in)[body].kind, TypeNodeKind::Union(_))
            || self.c.type_from_node(file, written) != parameter.ty
        {
            return None;
        }
        Some(self.text(name))
    }

    /// `serializeReturnTypeForSignature`. `parameters`: those the signature declares.
    fn return_type_text(&mut self, signature: SigId, parameters: &[Parameter]) -> String {
        let Some(predicate) = self.c.sig_predicate(signature) else {
            let returned = self.c.sig_return_for_inference(signature);
            if self.flags & REUSES_TYPE_NODES != 0
                && let Some((file, func, _)) = self.c.sig_decl(signature)
            {
                let written = self.c.hir(file)[func].ret;
                if written.is_some() {
                    let declared = self.c.type_from_node(file, written);
                    if self.c.instantiate(declared, self.mapper) == returned {
                        return self.type_node_to_node(file, written).text;
                    }
                }
            }
            return self.type_to_node(returned).text;
        };
        let mut text = String::new();
        if predicate.asserts {
            text.push_str("asserts ");
        }
        match predicate.param {
            Some(index) => {
                if let Some(parameter) = parameters.get(index) {
                    text.push_str(&parameter.name);
                }
            }
            None => text.push_str("this"),
        }
        if let Some(ty) = predicate.ty {
            text.push_str(" is ");
            text.push_str(&self.type_to_node(ty).text);
        }
        text
    }

    /// `getUnresolvedSymbolForEntityName`: what is written at `node`, if that is a reference by a name no type goes by. The error type it
    /// stands for has the name and the type arguments for an alias (`errorTypes`) and is written by them. A type does not keep that
    /// here: it can be told where the annotation is at hand and the type is all of it.
    fn unresolved_reference_to_node(&mut self, file: FileId, node: TypeNodeId) -> Option<Node> {
        if node.is_none() {
            return None;
        }
        let (hir, files) = (self.c.hir(file), self.c.files());
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        let scope = self.c.bound(file).type_scope[node.idx()];
        if scope.is_none()
            || self
                .c
                .intended_type_of_jsdoc_reference(file, node)
                .is_some()
        {
            return None;
        }
        let names: Vec<Atom> = hir.ids(name).collect();
        if names.is_empty() || names.contains(&known::empty) {
            return None;
        }
        // As `type_from_node` looks for it.
        let is_found = match files.resolve_entity(file, scope, &names, SymFlags::TYPE) {
            None => false,
            Some(found) if names.len() == 1 && self.is_out_of_reach(file, node, scope, found) => {
                false
            }
            Some(found) => match files.resolve_alias_as(found, SymFlags::TYPE) {
                Some(sym) => self.c.type_flags_of_symbol(sym).intersects(SymFlags::TYPE),
                None => !self.c.is_alias_in_error(found),
            },
        };
        if is_found {
            return None;
        }
        let mut arguments = Vec::with_capacity(args.len());
        for argument in hir.ids(args) {
            arguments.push(match self.unresolved_reference_to_node(file, argument) {
                Some(written) => written,
                None => {
                    let ty = self.c.type_from_node(file, argument);
                    self.type_to_node(ty)
                }
            });
        }
        // `symbolToEntityNameNode`
        let path: Vec<String> = names.iter().map(|&name| self.text(name)).collect();
        Some(Node::simple(format!(
            "{}{}",
            path.join("."),
            type_arguments_text(arguments)
        )))
    }

    /// `Resolve`: `found` is a type parameter of a class, named at `node` where those are not seen.
    fn is_out_of_reach(&self, file: FileId, node: TypeNodeId, scope: ScopeId, found: Sym) -> bool {
        self.c
            .is_static_reference_to_class_type_param(file, node, scope, found)
            || self
                .c
                .is_base_expression_reference_to_class_type_param(file, node, scope, found)
    }

    /// `parameter_text`, of a parameter whose type is written by a name no type goes by.
    fn unresolved_parameter_text(&mut self, parameter: &Parameter) -> Option<String> {
        let (file, p) = parameter.declaration?;
        let declared = &self.c.hir(file)[p];
        // `getOptionalType` of an error type is the plain one, which has no name.
        if parameter.ty != TypeId::ANY
            || declared.default.is_some()
            || parameter.optional && self.c.p.files.options.strict_null_checks
        {
            return None;
        }
        let written = self.unresolved_reference_to_node(file, declared.ty)?;
        self.approximate_length += parameter.name_length + 3;
        Some(format!(
            "{}{}{}: {}",
            if parameter.rest { "..." } else { "" },
            parameter.name,
            if parameter.optional { "?" } else { "" },
            written.text
        ))
    }

    /// `return_type_text`, of a signature whose return type is written by such a name.
    fn unresolved_return_type_text(&mut self, signature: SigId) -> Option<String> {
        let (file, func, _) = self.c.sig_decl(signature)?;
        let annotation = self.c.hir(file)[func].ret;
        if annotation.is_none()
            || self.c.sig_predicate(signature).is_some()
            || self.c.sig_return_for_inference(signature) != TypeId::ANY
        {
            return None;
        }
        Some(self.unresolved_reference_to_node(file, annotation)?.text)
    }

    /// `signatureToSignatureDeclarationHelper`, as the printer writes it, without the `;` of a member. `name`, `is_optional`: of a method.
    fn signature_to_text(
        &mut self,
        signature: SigId,
        kind: SignatureKind,
        name: &str,
        is_optional: bool,
    ) -> String {
        // `enterSignatureScope`
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
        self.approximate_length += 3;
        let mut type_parameters = Vec::new();
        for parameter in self.c.sig_type_params(signature) {
            type_parameters.push(self.type_parameter_declaration(parameter));
        }
        let mut parameters = Vec::with_capacity(expanded.len() + 1);
        for parameter in &expanded {
            parameters.push(match self.unresolved_parameter_text(parameter) {
                Some(text) => text,
                None => self.parameter_text(parameter),
            });
        }
        let this = match self.c.sig_this_type(signature) {
            Some(this) => Some(this),
            None => self.this_type_taken_from_context(signature),
        };
        if let Some(this) = this {
            let node = self.type_to_node(this);
            self.approximate_length += "this".len() + 3;
            parameters.insert(0, format!("this: {}", node.text));
        }
        let returned = match self.unresolved_return_type_text(signature) {
            Some(text) => text,
            None => self.return_type_text(signature, &declared),
        };
        self.mapper = saved_mapper;
        let type_parameters = if type_parameters.is_empty() {
            String::new()
        } else {
            format!("<{}>", type_parameters.join(", "))
        };
        let parameters = parameters.join(", ");
        match kind {
            SignatureKind::Call => format!("{type_parameters}({parameters}): {returned}"),
            SignatureKind::Construct => format!("new {type_parameters}({parameters}): {returned}"),
            SignatureKind::Method => {
                let question = if is_optional { "?" } else { "" };
                format!("{name}{question}{type_parameters}({parameters}): {returned}")
            }
            SignatureKind::FunctionType => format!("{type_parameters}({parameters}) => {returned}"),
            SignatureKind::ConstructorType => {
                let modifier = if self.c.is_abstract_signature(signature) {
                    "abstract "
                } else {
                    ""
                };
                format!("{modifier}new {type_parameters}({parameters}) => {returned}")
            }
        }
    }

    /// `assignContextualParameterTypes`: a context sensitive function that declares no `this` parameter gets that of the signature
    /// it is expected to have.
    fn this_type_taken_from_context(&mut self, signature: SigId) -> Option<TypeId> {
        let (file, func, mapper) = match *self.c.p.types.sig(signature) {
            SigData::WithReturn { sig: inner, .. } => {
                return self.this_type_taken_from_context(inner);
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
        Some(self.c.instantiate(this, mapper))
    }

    /// A function type or a constructor type.
    fn signature_to_node(&mut self, signature: SigId, kind: SignatureKind) -> Node {
        Node::new(self.signature_to_text(signature, kind, "", false), FUNCTION)
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
        let constraint = match over_keyof {
            // `isMappedTypeWithKeyofConstraintDeclaration`: `keyof` stays, whatever it comes to.
            Some((declared, true)) => {
                let of = self.c.instantiate(declared, mapper);
                let of = self.type_to_node(of);
                format!("keyof {}", of.emit(TYPE_OPERATOR))
            }
            _ => {
                let keys = self.c.mapped_keys(ty);
                self.type_to_node(keys).text
            }
        };
        let name = self.text(self.c.hir(file)[mapped.param].name);
        let renamed = match self.c.mapped_name_type(ty) {
            Some(name_type) => format!(" as {}", self.type_to_node(name_type).text),
            None => String::new(),
        };
        let template = self.c.mapped_template(ty);
        // The circle may go through a type alias, which is `any` then. That has no alias.
        let template = match self.c.data(template) {
            TypeData::LazyAlias { .. } if self.c.p.mapped_types_with_errors.get(&ty).is_some() => {
                let forced = self.c.force(template);
                if matches!(self.c.data(forced), TypeData::Intrinsic(_)) {
                    forced
                } else {
                    template
                }
            }
            _ => template,
        };
        let template = self
            .c
            .remove_missing_type(template, mapped.optional == MappedModifier::Add);
        let template = self.type_to_node(template);
        self.approximate_length += 10;
        let readonly = match mapped.readonly {
            MappedModifier::None => "",
            MappedModifier::Add => "readonly ",
            MappedModifier::Remove => "-readonly ",
        };
        let question = match mapped.optional {
            MappedModifier::None => "",
            MappedModifier::Add => "?",
            MappedModifier::Remove => "-?",
        };
        Node::simple(format!(
            "{{ {readonly}[{name} in {constraint}{renamed}]{question}: {}; }}",
            template.text
        ))
    }

    /// `typeToTypeNodeOrCircularityElision`
    fn type_to_node_or_circularity_elision(&mut self, ty: TypeId) -> Node {
        if !self.c.is_union(ty) {
            return self.type_to_node(ty);
        }
        if self.visited_types.contains(&ty) {
            return self.elided_information_placeholder();
        }
        let Some(depth) = self.enter_type(ty, None) else {
            return self.elided_information_placeholder();
        };
        let node = self.type_to_node(ty);
        self.leave_type(ty, None, depth);
        node
    }

    /// `conditionalTypeToTypeNode`, of the conditional type `ty` written at `node`.
    fn conditional_type_to_node(&mut self, ty: TypeId, file: FileId, node: TypeNodeId) -> Node {
        let TypeNodeKind::Cond { extends, .. } = self.c.hir(file)[node].kind else {
            return self.elided_information_placeholder();
        };
        if self.check_truncation_length() {
            return self.elided_information_placeholder();
        }
        let check = self.c.cond_piece(ty, 0);
        let check = self.type_to_node(check);
        self.approximate_length += 15;
        let mut declared = Vec::new();
        self.c.collect_infer_params(file, extends, &mut declared);
        let infer_type_parameters = declared
            .into_iter()
            .map(|parameter| self.c.type_param(file, parameter))
            .collect();
        let saved = std::mem::replace(&mut self.infer_type_parameters, infer_type_parameters);
        let extends = match self.unresolved_reference_to_node(file, extends) {
            Some(written) => written,
            None => {
                let extends = self.c.cond_piece(ty, 1);
                self.type_to_node(extends)
            }
        };
        self.infer_type_parameters = saved;
        let when_true = self.c.cond_piece(ty, 2);
        let when_true = self.type_to_node_or_circularity_elision(when_true);
        let when_false = self.c.cond_piece(ty, 3);
        let when_false = self.type_to_node_or_circularity_elision(when_false);
        // In the `extends` clause a conditional type is in parentheses.
        Node::new(
            format!(
                "{} extends {} ? {} : {}",
                check.emit(UNION),
                extends.emit(CONDITIONAL + 1),
                when_true.text,
                when_false.text
            ),
            CONDITIONAL,
        )
    }

    // ───────────────────────────── type nodes ─────────────────────────────

    /// The type `node` denotes under the mapper of the signature being written.
    fn resolved_type_node_to_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        let declared = self.c.type_from_node(file, node);
        let ty = self.c.instantiate(declared, self.mapper);
        self.type_to_node(ty)
    }

    fn type_nodes_to_nodes(&mut self, file: FileId, list: IdList<TypeNodeId>) -> Vec<Node> {
        let nodes: Vec<TypeNodeId> = self.c.hir(file).ids(list).collect();
        let mut result = Vec::with_capacity(nodes.len());
        for node in nodes {
            result.push(self.type_node_to_node(file, node));
        }
        result
    }

    /// `tryReuseExistingNodeHelper`: `node` as it is written. A reference to a type parameter, and syntax that declares something, is
    /// written as the type it denotes.
    fn type_node_to_node(&mut self, file: FileId, node: TypeNodeId) -> Node {
        if node.is_none() {
            return Node::simple("any");
        }
        if self.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return self.elided_information_placeholder();
        }
        self.depth += 1;
        let result = self.type_node_to_node_worker(file, node);
        self.depth -= 1;
        result
    }

    fn type_node_to_node_worker(&mut self, file: FileId, node: TypeNodeId) -> Node {
        let hir = self.c.hir(file);
        match hir[node].kind {
            TypeNodeKind::Keyword(keyword) => Node::simple(match keyword {
                Keyword::Any => "any",
                Keyword::Unknown => "unknown",
                Keyword::Never => "never",
                Keyword::Void => "void",
                Keyword::Undefined => "undefined",
                Keyword::Null => "null",
                Keyword::String => "string",
                Keyword::Number => "number",
                Keyword::Boolean => "boolean",
                Keyword::BigInt => "bigint",
                Keyword::Symbol => "symbol",
                Keyword::Object => "object",
                Keyword::This => "this",
                Keyword::Intrinsic => "intrinsic",
            }),
            TypeNodeKind::Ref { name, args } => {
                let declared = self.c.type_from_node(file, node);
                if matches!(self.c.data(declared), TypeData::TypeParam(..)) {
                    return self.resolved_type_node_to_node(file, node);
                }
                let names: Vec<String> = hir.ids(name).map(|part| self.text(part)).collect();
                let arguments = self.type_nodes_to_nodes(file, args);
                Node {
                    text: format!("{}{}", names.join("."), type_arguments_text(arguments)),
                    precedence: NON_ARRAY,
                    reference: match &names[..] {
                        [only] => Some(only.clone()),
                        _ => None,
                    },
                }
            }
            TypeNodeKind::StringLit(value) => {
                let quote = match hir.text.get(hir[node].pos as usize) {
                    Some(b'\'') => '\'',
                    _ => '"',
                };
                Node::simple(quoted(&self.text(value), quote, false))
            }
            TypeNodeKind::NumberLit(index) => Node::simple(crate::atom::number_to_string(
                hir.numbers.get(index as usize).copied().unwrap_or(0.0),
            )),
            TypeNodeKind::BoolLit(value) => Node::simple(if value { "true" } else { "false" }),
            TypeNodeKind::Array(element) => {
                let element = self.type_node_to_node(file, element);
                Node::new(format!("{}[]", element.emit(POSTFIX)), POSTFIX)
            }
            TypeNodeKind::Tuple(elems) => {
                let mut parts = Vec::with_capacity(elems.len());
                for e in elems.iter() {
                    let elem = hir[e];
                    let ty = self.type_node_to_node(file, elem.ty);
                    let dots = if elem.rest { "..." } else { "" };
                    let question = if elem.optional { "?" } else { "" };
                    parts.push(if elem.name.is_some() {
                        format!("{dots}{}{question}: {}", self.text(elem.name), ty.text)
                    } else if elem.optional {
                        format!("{}?", ty.emit(POSTFIX))
                    } else {
                        format!("{dots}{}", ty.text)
                    });
                }
                Node::simple(format!("[{}]", parts.join(", ")))
            }
            TypeNodeKind::Union(list) => {
                let nodes = self.type_nodes_to_nodes(file, list);
                Node::new(join_nodes(nodes, " | ", TYPE_OPERATOR), UNION)
            }
            TypeNodeKind::Intersection(list) => {
                let nodes = self.type_nodes_to_nodes(file, list);
                Node::new(join_nodes(nodes, " & ", TYPE_OPERATOR), INTERSECTION)
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                let object = self.type_node_to_node(file, obj);
                let index = self.type_node_to_node(file, index);
                Node::new(format!("{}[{}]", object.emit(POSTFIX), index.text), POSTFIX)
            }
            TypeNodeKind::Keyof(of) => {
                let of = self.type_node_to_node(file, of);
                Node::new(format!("keyof {}", of.emit(TYPE_OPERATOR)), TYPE_OPERATOR)
            }
            TypeNodeKind::Readonly(of) => {
                let of = self.type_node_to_node(file, of);
                Node::new(format!("readonly {}", of.emit(POSTFIX)), TYPE_OPERATOR)
            }
            TypeNodeKind::Typeof { name, args, .. } => {
                let names: Vec<String> = hir.ids(name).map(|part| self.text(part)).collect();
                let arguments = self.type_nodes_to_nodes(file, args);
                Node::new(
                    format!(
                        "typeof {}{}",
                        names.join("."),
                        type_arguments_text(arguments)
                    ),
                    TYPE_OPERATOR,
                )
            }
            _ => self.resolved_type_node_to_node(file, node),
        }
    }
}
