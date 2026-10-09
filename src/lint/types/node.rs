//! `ts.Node` and `ts.SourceFile`: the syntax of any file of the program.

use super::{ModifierFlags, NodeFlags, Signature, TsSymbol, Type};
use crate::ast::{self, File};
use crate::span::Span;
use bun_sema::check::services::{Child, FileInfo, NodeRef};
use bun_sema::node::{Node as RawNode, NodeData};
use bun_sema::program::FileId;

/// `ts.SyntaxKind`
pub use bun_sema::node::Kind as SyntaxKind;

/// `ts.Node`: a node of a file of the program, in the shape that TypeScript's syntax tree has.
///
/// This is what [`TsSymbol::declarations`] yields, which can be anywhere: in another file, in
/// `node_modules`, in `lib.d.ts`. Rules look at the kind, the modifiers, the name and the parent of
/// such a node, and at the file it is in. For the file that is linted, [`TsNode::to_ast`] leads back
/// to the handles of [`ast`], which know much more.
///
/// `ts.isParameter(node)` is `node.kind() == SyntaxKind::Parameter`.
#[derive(Copy, Clone)]
pub struct TsNode<'a> {
    file: &'a File<'a>,
    raw: NodeRef,
}

impl PartialEq for TsNode<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.raw == other.raw
    }
}
impl Eq for TsNode<'_> {}
impl std::hash::Hash for TsNode<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.raw.hash(state);
    }
}
impl std::fmt::Debug for TsNode<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{:?}({}:{})",
            self.kind(),
            self.raw.file.0,
            self.raw.node.0
        )
    }
}

impl<'a> TsNode<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, in_file: FileId, node: RawNode) -> Self {
        TsNode {
            file,
            raw: NodeRef {
                file: in_file,
                node,
            },
        }
    }

    #[inline]
    pub(crate) fn of(file: &'a File<'a>, raw: NodeRef) -> Self {
        TsNode { file, raw }
    }

    #[inline]
    fn some(self, node: RawNode) -> Option<Self> {
        node.is_some()
            .then(|| TsNode::new(self.file, self.raw.file, node))
    }

    #[inline]
    pub(crate) fn raw(self) -> NodeRef {
        self.raw
    }

    /// `node.kind`
    pub fn kind(self) -> SyntaxKind {
        self.file.query(|q| q.node_kind(self.raw))
    }

    /// `node.parent`. `None` for a `SourceFile`.
    pub fn parent(self) -> Option<TsNode<'a>> {
        self.some(self.file.query(|q| q.node_parent(self.raw)))
    }

    /// Its parent, the parent of that, and so on. The last is the `SourceFile`.
    pub fn ancestors(self) -> impl Iterator<Item = TsNode<'a>> {
        std::iter::successors(self.parent(), |node| node.parent())
    }

    fn child(self, child: Child) -> Option<TsNode<'a>> {
        self.some(self.file.query(|q| q.node_child(self.raw, child)))
    }

    /// `node.name`, `ts.getNameOfDeclaration(node)`
    pub fn name(self) -> Option<TsNode<'a>> {
        self.child(Child::Name)
    }

    /// `node.propertyName` of a specifier or a binding element.
    pub fn property_name(self) -> Option<TsNode<'a>> {
        self.child(Child::PropertyName)
    }

    /// `node.expression`
    pub fn expression(self) -> Option<TsNode<'a>> {
        self.child(Child::Expression)
    }

    /// `node.initializer`
    pub fn initializer(self) -> Option<TsNode<'a>> {
        self.child(Child::Initializer)
    }

    /// `node.type`
    pub fn type_node(self) -> Option<TsNode<'a>> {
        self.child(Child::Type)
    }

    /// `node.constraint` of a type parameter.
    pub fn constraint(self) -> Option<TsNode<'a>> {
        self.child(Child::Constraint)
    }

    /// `node.default` of a type parameter.
    pub fn default_type(self) -> Option<TsNode<'a>> {
        self.child(Child::Default)
    }

    /// `ts.forEachChild(node, ..)`
    pub fn children(self) -> impl ExactSizeIterator<Item = TsNode<'a>> + 'a {
        let children = self.file.query(|q| q.node_children(self.raw));
        children
            .iter()
            .map(move |&node| TsNode::new(self.file, self.raw.file, node))
    }

    /// `node.text` of an identifier, a private identifier, a string or a numeric literal. Empty for
    /// any other node.
    pub fn text(self) -> &'a [u8] {
        self.file.query(|q| q.node_text(self.raw))
    }

    /// `node.getText()`. Empty in a file of the default library, whose text is not kept.
    pub fn get_source_text(self) -> &'a [u8] {
        self.file.query(|q| q.node_source_text(self.raw))
    }

    /// The flags that the HIR has for the node, which besides the modifiers tell of tokens.
    fn hir_flags(self) -> ast::Flags {
        self.file.query(|q| q.node_hir_flags(self.raw))
    }

    /// `ts.isTypeOnlyImportOrExportDeclaration(node)`: a specifier, a clause or a namespace import
    /// or export that is `type` itself or is part of an `import type` or an `export type`.
    pub fn is_type_only_import_or_export_declaration(self) -> bool {
        self.file.query(|q| q.is_type_only(self.raw, true))
    }

    /// `node.questionToken !== undefined`: of a parameter, a property, a method.
    pub fn has_question_token(self) -> bool {
        self.hir_flags().contains(ast::Flags::OPTIONAL)
    }

    /// `node.dotDotDotToken !== undefined`: of a parameter or a binding element.
    pub fn has_dot_dot_dot_token(self) -> bool {
        self.hir_flags().contains(ast::Flags::REST)
    }

    /// `node.exclamationToken !== undefined`: of a variable or a property.
    pub fn has_exclamation_token(self) -> bool {
        self.hir_flags().contains(ast::Flags::DEFINITE)
    }

    /// `ts.getCombinedModifierFlags(node)`
    pub fn modifier_flags(self) -> ModifierFlags {
        self.file.query(|q| q.node_modifier_flags(self.raw))
    }

    /// `tsutils.isModifierFlagSet(node, flags)`
    pub fn has_modifier(self, flags: ModifierFlags) -> bool {
        self.modifier_flags().intersects(flags)
    }

    /// `ts.getCombinedNodeFlags(node)`
    pub fn flags(self) -> NodeFlags {
        self.file.query(|q| q.node_flags(self.raw))
    }

    /// `node.getSourceFile()`
    #[inline]
    pub fn get_source_file(self) -> SourceFile<'a> {
        SourceFile::new(self.file, self.raw.file)
    }

    /// It is in the file that is linted.
    #[inline]
    pub fn is_in_linted_file(self) -> bool {
        self.raw.file == self.file.id_in_program()
    }

    /// `[node.getStart(), node.getEnd()]`, which is a range of the text of **its** file. `0..0` in a
    /// file of the default library, whose text is not kept, and for some of the nodes that have no
    /// handle in [`ast`]: a `TemplateSpan`, a `CaseBlock`, `NamedExports`.
    pub fn span(self) -> Span {
        let (start, end) = self.file.query(|q| q.node_span(self.raw));
        Span::new(start, end)
    }

    /// `services.tsNodeToESTreeNodeMap.get(node)`. `None` if it is in another file, or if it is a
    /// node that has no handle: a name, a `Block` that is the body of a function, a heritage
    /// clause.
    pub fn to_ast(self) -> Option<ast::Node<'a>> {
        if !self.is_in_linted_file() {
            return None;
        }
        let file = self.file;
        Some(match file.query(|q| q.node_data(self.raw)) {
            NodeData::File => ast::Node::File(file),
            NodeData::Expr(id) => ast::Node::Expr(ast::Expr::some(file, id)?),
            NodeData::Stmt(id) => ast::Node::Stmt(ast::Stmt::some(file, id)?),
            NodeData::Type(id) => ast::Node::Type(ast::TypeNode::some(file, id)?),
            NodeData::Pat(id) => ast::Node::Pat(ast::Pat::some(file, id)?),
            NodeData::PatProp(id) => ast::Node::PatProp(ast::PatProp::some(file, id)?),
            NodeData::PatElem(id) => ast::Node::PatElem(ast::PatElem::some(file, id)?),
            NodeData::Param(id) => ast::Node::Param(ast::Param::some(file, id)?),
            NodeData::TypeParam(id) => ast::Node::TypeParam(ast::TypeParam::some(file, id)?),
            NodeData::Member(id) => ast::Node::Member(ast::Member::some(file, id)?),
            NodeData::Prop(id) => ast::Node::Prop(ast::Prop::some(file, id)?),
            NodeData::VarDecl(id) => ast::Node::VarDecl(ast::VarDecl::some(file, id)?),
            NodeData::Case(id) => ast::Node::Case(ast::Case::some(file, id)?),
            NodeData::EnumMember(id) => ast::Node::EnumMember(ast::EnumMember::some(file, id)?),
            NodeData::ImportSpec(id) => ast::Node::ImportSpec(ast::ImportSpec::some(file, id)?),
            NodeData::ExportSpec(id) => ast::Node::ExportSpec(ast::ExportSpec::some(file, id)?),
            NodeData::TupleElem(id) => ast::Node::TupleElem(ast::TupleElem::some(file, id)?),
            NodeData::Paren(_) => return self.expression()?.to_ast(),
            NodeData::None | NodeData::Modifier(_) | NodeData::Name(_) | NodeData::Part(..) => {
                return None;
            }
        })
    }

    // ───────────────────────────── ts.TypeChecker ─────────────────────────────

    /// `checker.getTypeAtLocation(node)`
    pub fn get_type_at_location(self) -> Type<'a> {
        Type::new(self.file, self.file.query(|q| q.type_at_location(self.raw)))
    }

    /// `checker.getSymbolAtLocation(node)`
    pub fn get_symbol_at_location(self) -> Option<TsSymbol<'a>> {
        let id = self.file.query(|q| q.symbol_at_location(self.raw))?;
        Some(TsSymbol::new(self.file, id))
    }

    /// `checker.getTypeFromTypeNode(node)`
    pub fn get_type_from_type_node(self) -> Type<'a> {
        Type::new(
            self.file,
            self.file.query(|q| q.type_from_type_node(self.raw)),
        )
    }

    /// `checker.getContextFreeTypeOfExpression(node)` as one gets it who asks before anything has resolved the call
    /// `node`: its type where nothing is expected of it. Nothing of it is kept: ask once.
    pub fn get_context_free_type_of_call_resolved_afresh(self) -> Type<'a> {
        let id = self
            .file
            .query(|q| q.context_free_type_of_call_resolved_afresh(self.raw));
        Type::new(self.file, id)
    }

    /// `checker.getContextualType(node)`
    pub fn get_contextual_type(self) -> Option<Type<'a>> {
        let id = self.file.query(|q| q.contextual_type(self.raw))?;
        Some(Type::new(self.file, id))
    }

    /// `checker.getContextualTypeForArgumentAtIndex(node, index)`
    pub fn get_contextual_type_for_argument_at_index(self, index: usize) -> Option<Type<'a>> {
        let index = index as u32;
        let id = self
            .file
            .query(|q| q.contextual_type_for_argument_at_index(self.raw, index))?;
        Some(Type::new(self.file, id))
    }

    /// `checker.getResolvedSignature(node)`
    pub fn get_resolved_signature(self) -> Option<Signature<'a>> {
        let id = self.file.query(|q| q.resolved_signature(self.raw))?;
        Some(Signature::new(self.file, id))
    }

    /// `checker.getSignatureFromDeclaration(node)`
    pub fn get_signature_from_declaration(self) -> Option<Signature<'a>> {
        let id = self
            .file
            .query(|q| q.signature_from_declaration(self.raw))?;
        Some(Signature::new(self.file, id))
    }

    /// `checker.getShorthandAssignmentValueSymbol(node)`
    pub fn get_shorthand_assignment_value_symbol(self) -> Option<TsSymbol<'a>> {
        let id = self
            .file
            .query(|q| q.shorthand_assignment_value_symbol(self.raw))?;
        Some(TsSymbol::new(self.file, id))
    }
}

/// `ts.SourceFile`, and what `ts.Program` knows about it.
#[derive(Copy, Clone)]
pub struct SourceFile<'a> {
    file: &'a File<'a>,
    id: FileId,
}

impl PartialEq for SourceFile<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for SourceFile<'_> {}
impl std::fmt::Debug for SourceFile<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SourceFile({:?})", bstr::BStr::new(self.file_name()))
    }
}

impl<'a> SourceFile<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: FileId) -> Self {
        SourceFile { file, id }
    }

    fn info(self) -> FileInfo<'a> {
        self.file.query(|q| q.file_info(self.id))
    }

    /// The `SourceFile` as a node.
    #[inline]
    pub fn node(self) -> TsNode<'a> {
        TsNode::new(self.file, self.id, RawNode::FILE)
    }

    /// `checker.getSymbolAtLocation(sourceFile)`: the module. `None` for a script.
    pub fn symbol(self) -> Option<TsSymbol<'a>> {
        self.node().get_symbol_at_location()
    }

    /// `sourceFile.fileName`: absolute, with `/` as the separator.
    pub fn file_name(self) -> &'a [u8] {
        self.info().file_name
    }

    /// `program.isSourceFileDefaultLibrary(sourceFile)`: a `lib.*.d.ts` of TypeScript.
    pub fn is_default_library(self) -> bool {
        self.info().is_default_library
    }

    /// `program.isSourceFileFromExternalLibrary(sourceFile)`: it was found in `node_modules`.
    pub fn is_from_external_library(self) -> bool {
        self.info().is_from_external_library
    }

    /// `program.sourceFileToPackageName.get(sourceFile.path)`: `foo` or `@scope/foo` for a file in
    /// `node_modules/foo`. For `@types/foo` it is `@types/foo`.
    pub fn package_name(self) -> Option<&'a [u8]> {
        self.info().package_name
    }

    /// It is the file that is linted.
    #[inline]
    pub fn is_linted_file(self) -> bool {
        self.id == self.file.id_in_program()
    }
}

impl TsNode<'_> {
    /// `clause.token` of a `HeritageClause`: `ExtendsKeyword` or `ImplementsKeyword`. `Unknown` for
    /// any other node.
    pub fn token(self) -> SyntaxKind {
        use bun_sema::node::Part;
        match self.file.query(|q| q.node_data(self.raw)) {
            NodeData::Part(Part::Extends, _) => SyntaxKind::ExtendsKeyword,
            NodeData::Part(Part::Implements, _) => SyntaxKind::ImplementsKeyword,
            _ => SyntaxKind::Unknown,
        }
    }
}
