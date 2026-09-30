// internal/ast/ast.go: the hand-written helpers beside the node table: write access, the records that a source file keeps beside its tree, pragmas.
use crate::ast::*;
use crate::collections::Set;
use crate::core::{
    List, ModuleKind, RESOLUTION_MODE_ESM, RESOLUTION_MODE_NONE, ResolutionMode, TextPos, TextRange,
};
use crate::internal::FaultKind;
use crate::tspath;

// Go stacks grow: a walk that follows the depth of the tree ends here with an internal diagnostic when the thread has no stack left.
#[inline]
fn stack_is_safe(a: Ast<'_>, node: NodeId) -> bool {
    if bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    stack_limit(a, node);
    false
}

#[cold]
fn stack_limit(a: Ast<'_>, node: NodeId) {
    a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
}

impl<'a> Ast<'a> {
    // EagerJSDoc returns JSDoc nodes that have already been parsed and cached, without triggering lazy JSDoc parsing: a table holds every JSDoc node that its producer attached, so nothing is lazy here.
    pub fn eager_jsdoc(self, node: NodeId) -> List<'a, NodeId> {
        self.jsdoc(node)
    }

    // Node.IsJSDoc
    pub fn is_jsdoc(self, node: NodeId) -> bool {
        self.kind(node) == Kind::JSDoc
    }

    // ImportAttributesNode.GetResolutionModeOverride
    pub fn get_resolution_mode_override(self, node: NodeId) -> (ResolutionMode, bool) {
        get_resolution_mode_override(self, node)
    }
}

pub fn is_write_only_access(a: Ast<'_>, node: NodeId) -> bool {
    access_kind(a, node) == AccessKind::WRITE
}

pub fn is_write_access(a: Ast<'_>, node: NodeId) -> bool {
    access_kind(a, node) != AccessKind::READ
}

pub fn is_write_access_for_reference(a: Ast<'_>, node: NodeId) -> bool {
    let decl = get_declaration_from_name(a, node);
    (!decl.is_nil() && declaration_is_write_access(a, decl))
        || a.kind(node) == Kind::DefaultKeyword
        || is_write_access(a, node)
}

pub fn get_declaration_from_name(a: Ast<'_>, name: NodeId) -> NodeId {
    if name.is_nil() || a.parent(name).is_nil() {
        return NodeId::NIL;
    }
    let parent = a.parent(name);
    match a.kind(name) {
        Kind::StringLiteral
        | Kind::NoSubstitutionTemplateLiteral
        | Kind::NumericLiteral
        | Kind::Identifier => {
            // Upstream's literal case falls through into the identifier case.
            if a.kind(name) != Kind::Identifier && is_computed_property_name(a, parent) {
                return a.parent(parent);
            }
            if is_declaration(a, parent) {
                if a.name(parent) == name {
                    return parent;
                }
                return NodeId::NIL;
            }
            if is_qualified_name(a, parent) {
                let tag = a.parent(parent);
                if is_jsdoc_parameter_tag(a, tag) && a.name(tag) == parent {
                    return tag;
                }
                return NodeId::NIL;
            }
            let bin_exp = a.parent(parent);
            if is_binary_expression(a, bin_exp)
                && get_assignment_declaration_kind(a, bin_exp) != JSDeclarationKind::NONE
            {
                // (binExp.left as BindableStaticNameExpression).symbol || binExp.symbol
                let left = a.as_binary_expression(bin_exp).left;
                let left_has_symbol = !left.is_nil() && !a.symbol(left).is_nil();
                if (left_has_symbol || !a.symbol(bin_exp).is_nil())
                    && get_name_of_declaration(a, bin_exp) == name
                {
                    return bin_exp;
                }
            }
        }
        Kind::PrivateIdentifier => {
            if is_declaration(a, parent) && a.name(parent) == name {
                return parent;
            }
        }
        _ => {}
    }
    NodeId::NIL
}

fn declaration_is_write_access(a: Ast<'_>, decl: NodeId) -> bool {
    if decl.is_nil() {
        return false;
    }
    // Consider anything in an ambient declaration to be a write access since it may be coming from JS.
    if a.flags(decl).intersects(NodeFlags::AMBIENT) {
        return true;
    }

    match a.kind(decl) {
        Kind::BinaryExpression
        | Kind::BindingElement
        | Kind::ClassDeclaration
        | Kind::ClassExpression
        | Kind::DefaultKeyword
        | Kind::EnumDeclaration
        | Kind::EnumMember
        | Kind::ExportSpecifier
        | Kind::ImportClause
        | Kind::ImportEqualsDeclaration
        | Kind::ImportSpecifier
        | Kind::InterfaceDeclaration
        | Kind::JSDocCallbackTag
        | Kind::JSDocTypedefTag
        | Kind::JsxAttribute
        | Kind::ModuleDeclaration
        | Kind::NamespaceExportDeclaration
        | Kind::NamespaceImport
        | Kind::NamespaceExport
        | Kind::Parameter
        | Kind::ShorthandPropertyAssignment
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::TypeParameter => true,
        // In `({ x: y } = 0);`, `x` is not a write access.
        Kind::PropertyAssignment => {
            !is_array_literal_or_object_literal_destructuring_pattern(a, a.parent(decl))
        }
        // functions considered write if they provide a value (have a body)
        Kind::FunctionDeclaration => !a.as_function_declaration(decl).body.is_nil(),
        Kind::FunctionExpression => !a.as_function_expression(decl).body.is_nil(),
        Kind::Constructor => !a.as_constructor_declaration(decl).body.is_nil(),
        Kind::MethodDeclaration => !a.as_method_declaration(decl).body.is_nil(),
        Kind::GetAccessor => !a.as_get_accessor_declaration(decl).body.is_nil(),
        Kind::SetAccessor => !a.as_set_accessor_declaration(decl).body.is_nil(),
        // variable/property write if initializer present or is in catch clause
        Kind::VariableDeclaration => {
            !a.as_variable_declaration(decl).initializer.is_nil()
                || is_catch_clause(a, a.parent(decl))
        }
        Kind::PropertyDeclaration => {
            !a.as_property_declaration(decl).initializer.is_nil()
                || is_catch_clause(a, a.parent(decl))
        }
        Kind::MethodSignature
        | Kind::PropertySignature
        | Kind::JSDocPropertyTag
        | Kind::JSDocParameterTag => false,
        // preserve TS behavior: upstream crashes on unexpected kinds
        _ => a.unhandled("Unhandled case in declarationIsWriteAccess", decl),
    }
}

pub fn is_array_literal_or_object_literal_destructuring_pattern(a: Ast<'_>, node: NodeId) -> bool {
    if !(is_array_literal_expression(a, node) || is_object_literal_expression(a, node)) {
        return false;
    }
    let parent = a.parent(node);
    // [a,b,c] from: [a, b, c] = someExpression;
    if is_binary_expression(a, parent) {
        let binary = a.as_binary_expression(parent);
        if binary.left == node && a.kind(binary.operator_token) == Kind::EqualsToken {
            return true;
        }
    }
    // [a, b, c] from: for([a, b, c] of expression)
    if is_for_of_statement(a, parent) && a.initializer(parent) == node {
        return true;
    }
    if !stack_is_safe(a, node) {
        return false;
    }
    // {x, a: {a, b, c} } = someExpression
    if is_property_assignment(a, parent) {
        return is_array_literal_or_object_literal_destructuring_pattern(a, a.parent(parent));
    }
    // [a, b, c] of [x, [a, b, c] ] = someExpression
    is_array_literal_or_object_literal_destructuring_pattern(a, parent)
}

fn access_kind(a: Ast<'_>, node: NodeId) -> AccessKind {
    let parent = a.parent(node);
    if parent.is_nil() {
        return AccessKind::READ;
    }
    if !stack_is_safe(a, node) {
        return AccessKind::READ;
    }
    match a.kind(parent) {
        Kind::ParenthesizedExpression => access_kind(a, parent),
        Kind::PrefixUnaryExpression => {
            let operator = a.as_prefix_unary_expression(parent).operator;
            if operator == Kind::PlusPlusToken || operator == Kind::MinusMinusToken {
                return AccessKind::READ_WRITE;
            }
            AccessKind::READ
        }
        Kind::PostfixUnaryExpression => {
            let operator = a.as_postfix_unary_expression(parent).operator;
            if operator == Kind::PlusPlusToken || operator == Kind::MinusMinusToken {
                return AccessKind::READ_WRITE;
            }
            AccessKind::READ
        }
        Kind::BinaryExpression => {
            let binary = a.as_binary_expression(parent);
            if binary.left == node {
                let operator = a.kind(binary.operator_token);
                if is_assignment_operator(operator) {
                    if operator == Kind::EqualsToken {
                        return AccessKind::WRITE;
                    }
                    return AccessKind::READ_WRITE;
                }
            }
            AccessKind::READ
        }
        Kind::PropertyAccessExpression => {
            if a.as_property_access_expression(parent).name != node {
                return AccessKind::READ;
            }
            access_kind(a, parent)
        }
        Kind::PropertyAssignment => {
            let parent_access = access_kind(a, a.parent(parent));
            // In `({ x: varname }) = { x: 1 }`, the left `x` is a read, the right `x` is a write.
            if node == a.as_property_assignment(parent).name {
                return reverse_access_kind(a, parent, parent_access);
            }
            parent_access
        }
        Kind::ShorthandPropertyAssignment => {
            // Assume it's the local variable being accessed, since we don't check public properties for --noUnusedLocals.
            if node
                == a.as_shorthand_property_assignment(parent)
                    .object_assignment_initializer
            {
                return AccessKind::READ;
            }
            access_kind(a, a.parent(parent))
        }
        Kind::ArrayLiteralExpression => access_kind(a, parent),
        Kind::ForInStatement | Kind::ForOfStatement => {
            if node == a.as_for_in_or_of_statement(parent).initializer {
                return AccessKind::WRITE;
            }
            AccessKind::READ
        }
        _ => AccessKind::READ,
    }
}

// The node is where the internal diagnostic of a value that is none of the three kinds points.
fn reverse_access_kind(a: Ast<'_>, node: NodeId, kind: AccessKind) -> AccessKind {
    if kind == AccessKind::READ {
        return AccessKind::WRITE;
    }
    if kind == AccessKind::WRITE {
        return AccessKind::READ;
    }
    if kind == AccessKind::READ_WRITE {
        return AccessKind::READ_WRITE;
    }
    a.unhandled("Unhandled case in reverseAccessKind", node)
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct AccessKind(pub i32);

impl AccessKind {
    // Only reads from a variable
    pub const READ: Self = Self(0);
    // Only writes to a variable without ever reading it. E.g.: `x=1;`.
    pub const WRITE: Self = Self(1);
    // Reads from and writes to a variable. E.g.: `f(x++);`, `x/=1`.
    pub const READ_WRITE: Self = Self(2);
}

// DeclarationBase

pub fn is_declaration_node(a: Ast<'_>, node: NodeId) -> bool {
    a.has_declaration_data(node)
}

// LocalsContainerBase

pub fn is_locals_container(a: Ast<'_>, node: NodeId) -> bool {
    a.has_locals_container_data(node)
}

pub fn is_type_or_js_type_alias_declaration(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::TypeAliasDeclaration || kind == Kind::JSTypeAliasDeclaration
}

pub fn is_import_declaration_or_js_import_declaration(a: Ast<'_>, node: NodeId) -> bool {
    let kind = a.kind(node);
    kind == Kind::ImportDeclaration || kind == Kind::JSImportDeclaration
}

pub fn is_any_export_assignment(a: Ast<'_>, node: NodeId) -> bool {
    a.kind(node) == Kind::ExportAssignment
}

// ImportAttributesNode.GetResolutionModeOverride. Upstream leaves the grammar errors of each early return to the checker.
pub fn get_resolution_mode_override(a: Ast<'_>, node: NodeId) -> (ResolutionMode, bool) {
    if node.is_nil() {
        return (RESOLUTION_MODE_NONE, false);
    }

    let attributes = a.nodes(a.as_import_attributes(node).attributes);

    if attributes.len() != 1 {
        return (RESOLUTION_MODE_NONE, false);
    }

    let elem = a.as_import_attribute(attributes.at(0));
    if !is_string_literal_like(a, elem.name) {
        return (RESOLUTION_MODE_NONE, false);
    }
    if a.text(elem.name) != b"resolution-mode" {
        return (RESOLUTION_MODE_NONE, false);
    }
    if !is_string_literal_like(a, elem.value) {
        return (RESOLUTION_MODE_NONE, false);
    }
    let value = a.text(elem.value);
    if value != b"import" && value != b"require" {
        return (RESOLUTION_MODE_NONE, false);
    }
    if value == b"import" {
        (RESOLUTION_MODE_ESM, true)
    } else {
        (ModuleKind::COMMON_JS, true)
    }
}

// PatternAmbientModule

pub struct PatternAmbientModule {
    pub pattern: crate::core::Pattern,
    pub symbol: SymbolId,
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct CommentDirectiveKind(pub i32);

impl CommentDirectiveKind {
    pub const UNKNOWN: Self = Self(0);
    pub const EXPECT_ERROR: Self = Self(1);
    pub const IGNORE: Self = Self(2);
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    pub loc: TextRange,
    pub kind: CommentDirectiveKind,
}

// SourceFile

#[derive(Clone, Default, Debug)]
pub struct SourceFileMetaData {
    pub package_json_type: Vec<u8>,
    pub package_json_directory: Vec<u8>,
    pub implied_node_format: ResolutionMode,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CheckJsDirective {
    pub enabled: bool,
    pub range: CommentRange,
}

pub trait HasFileName {
    fn file_name(&self) -> &[u8];
    fn path(&self) -> &tspath::Path;
}

pub fn collect_identifiers_for_source_file<'a>(a: Ast<'a>, source_file: NodeId) -> Set<&'a [u8]> {
    let mut identifiers = Set::default();
    collect_identifiers(a, source_file, &mut identifiers);
    identifiers
}

fn collect_identifiers<'a>(a: Ast<'a>, node: NodeId, identifiers: &mut Set<&'a [u8]>) -> bool {
    match a.kind(node) {
        Kind::Identifier
        | Kind::PrivateIdentifier
        | Kind::StringLiteral
        | Kind::NumericLiteral
        | Kind::BigIntLiteral
        | Kind::NoSubstitutionTemplateLiteral => {
            identifiers.add(a.text(node));
        }
        _ => {}
    }
    if stack_is_safe(a, node) {
        a.for_each_child(node, &mut |child| {
            collect_identifiers(a, child, identifiers)
        });
    }
    false
}

pub fn get_declaration_name<'a>(a: Ast<'a>, declaration: NodeId) -> &'a [u8] {
    let name = get_non_assigned_name_of_declaration(a, declaration);
    if !name.is_nil() {
        if is_computed_property_name(a, name) {
            let expression = a.expression(name);
            if is_string_or_numeric_literal_like(a, expression) {
                return a.text(expression);
            }
            if is_property_access_expression(a, expression) {
                return a.text(a.name(expression));
            }
        } else if is_property_name(a, name) {
            return a.text(name);
        }
    }
    b""
}

// What the line functions of the scanner read of a file: a source file, or a text that stands in for one.
pub trait SourceFileLike {
    fn text(&self) -> &[u8];
    fn ecma_line_map(&self) -> &[TextPos];
}

impl SourceFileLike for SourceFile<'_> {
    fn text(&self) -> &[u8] {
        (*self).text()
    }

    fn ecma_line_map(&self) -> &[TextPos] {
        (*self).ecma_line_map()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentRange {
    pub text_range: TextRange,
    pub kind: Kind,
    pub has_trailing_new_line: bool,
}

impl CommentRange {
    pub fn pos(&self) -> i32 {
        self.text_range.pos()
    }

    pub fn end(&self) -> i32 {
        self.text_range.end()
    }
}

// NodeFactory.NewCommentRange: the factory is not read.
pub fn new_comment_range(
    kind: Kind,
    pos: i32,
    end: i32,
    has_trailing_new_line: bool,
) -> CommentRange {
    CommentRange {
        text_range: crate::core::new_text_range(pos as _, end as _),
        kind,
        has_trailing_new_line,
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FileReference {
    pub text_range: TextRange,
    pub file_name: Vec<u8>,
    pub resolution_mode: ResolutionMode,
    pub preserve: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PragmaArgument {
    pub text_range: TextRange,
    pub name: Vec<u8>,
    pub value: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Pragma {
    pub comment_range: CommentRange,
    pub name: Vec<u8>,
    // Upstream keeps a map by argument name: a pragma has at most a handful of arguments, and a list keeps their order.
    pub args: Vec<PragmaArgument>,
}

impl Pragma {
    // `pragma.Args[name]`: a later argument of the same name replaces an earlier one, as an assignment into the map does.
    pub fn arg(&self, name: &[u8]) -> Option<&PragmaArgument> {
        self.args.iter().rev().find(|arg| arg.name == name)
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct PragmaKindFlags(pub u8);

impl PragmaKindFlags {
    pub const TRIPLE_SLASH_XML: Self = Self(1 << 0);
    pub const SINGLE_LINE: Self = Self(1 << 1);
    pub const MULTI_LINE: Self = Self(1 << 2);
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::TRIPLE_SLASH_XML.0 | Self::SINGLE_LINE.0 | Self::MULTI_LINE.0);
    pub const DEFAULT: Self = Self::ALL;

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PragmaArgumentSpecification {
    pub name: &'static [u8],
    pub optional: bool,
    pub capture_span: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PragmaSpecification {
    pub args: &'static [PragmaArgumentSpecification],
    pub kind: PragmaKindFlags,
}

impl PragmaSpecification {
    pub fn is_triple_slash(&self) -> bool {
        self.kind.intersects(PragmaKindFlags::TRIPLE_SLASH_XML)
    }
}
