//! `symbol.getJsDocTags()`, as far as `@deprecated` goes.
//!
//! JSDoc comments of TypeScript files are not parsed. What is asked here is found in the text,
//! where TypeScript's parser attaches the comments: before the first token of a declaration.

use super::super::spans::{get_leading_comment_ranges, get_trailing_comment_ranges};
use super::*;

/// What the tags of some JSDoc comments say.
#[derive(Default)]
struct Tags {
    /// There is a tag.
    has_any: bool,
    /// The text of the first `@deprecated`.
    deprecated: Option<Vec<u8>>,
    has_inherit_doc: bool,
    /// `@typedef`, `@callback`
    has_typedef: bool,
    /// `@param`, `@returns`
    has_parameter_or_return: bool,
}

impl Tags {
    fn add(&mut self, other: Tags) {
        self.has_any |= other.has_any;
        self.has_inherit_doc |= other.has_inherit_doc;
        self.has_typedef |= other.has_typedef;
        self.has_parameter_or_return |= other.has_parameter_or_return;
        if self.deprecated.is_none() {
            self.deprecated = other.deprecated;
        }
    }
}

/// `HasJSDoc`: the kinds of nodes that the parser attaches JSDoc comments to.
fn can_have_js_doc(kind: Kind) -> bool {
    use Kind::*;
    matches!(
        kind,
        GetAccessor
            | SetAccessor
            | ArrowFunction
            | BinaryExpression
            | Block
            | BreakStatement
            | CallSignature
            | CaseClause
            | ClassDeclaration
            | ClassExpression
            | ClassStaticBlockDeclaration
            | Constructor
            | ConstructorType
            | ConstructSignature
            | ContinueStatement
            | DebuggerStatement
            | DoStatement
            | ElementAccessExpression
            | EmptyStatement
            | EnumDeclaration
            | EnumMember
            | ExportAssignment
            | ExportDeclaration
            | ExportSpecifier
            | ExpressionStatement
            | ForInStatement
            | ForOfStatement
            | ForStatement
            | FunctionDeclaration
            | FunctionExpression
            | FunctionType
            | Identifier
            | IfStatement
            | ImportDeclaration
            | ImportEqualsDeclaration
            | IndexSignature
            | InterfaceDeclaration
            | LabeledStatement
            | MethodDeclaration
            | MethodSignature
            | ModuleDeclaration
            | NamedTupleMember
            | NamespaceExportDeclaration
            | ObjectLiteralExpression
            | Parameter
            | ParenthesizedExpression
            | PropertyAccessExpression
            | PropertyAssignment
            | PropertyDeclaration
            | PropertySignature
            | ReturnStatement
            | SemicolonClassElement
            | ShorthandPropertyAssignment
            | SpreadAssignment
            | SwitchStatement
            | ThrowStatement
            | TryStatement
            | TypeAliasDeclaration
            | TypeParameter
            | VariableDeclaration
            | VariableStatement
            | WhileStatement
            | WithStatement
    )
}

/// The length of `{@link ..}` at the start of `text`. 0 if there is none.
fn link_len(text: &[u8]) -> usize {
    let Some(rest) = text.strip_prefix(b"{@link") else {
        return 0;
    };
    let rest = rest.strip_prefix(b"code").or_else(|| rest.strip_prefix(b"plain")).unwrap_or(rest);
    if rest.first().is_some_and(|&next| is_identifier_part(next)) {
        return 0;
    }
    bun_core::strings::index_of_char_usize(text, b'}').map_or(0, |close| close + 1)
}

/// `parseTagComments`: `text`, which follows the name of a tag and ends before the next tag,
/// without the margin of each line.
fn tag_comment(text: &[u8]) -> Vec<u8> {
    let mut comment = Vec::new();
    for (index, line) in bun_core::strings::split(text, b"\n").enumerate() {
        let mut line = line.trim_ascii_start();
        if index > 0 {
            line = line.strip_prefix(b"*").unwrap_or(line).trim_ascii_start();
            // `removeLeadingNewlines`
            if !comment.is_empty() {
                comment.push(b'\n');
            }
        }
        comment.extend_from_slice(line.strip_suffix(b"\r").unwrap_or(line));
    }
    comment.truncate(comment.trim_ascii_end().len());
    comment
}

/// The tags of the comment `/** .. */`.
fn parse_tags(comment: &[u8]) -> Tags {
    let mut tags = Tags::default();
    let text = comment.strip_suffix(b"*/").unwrap_or(comment);
    // Where each tag begins: at every `@` that is not in a link.
    let mut starts: SmallVec<[usize; 8]> = SmallVec::new();
    let mut at = 0;
    while let Some(found) = bun_core::strings::index_of_any(&text[at..], b"@{") {
        at += found;
        match text[at] {
            b'@' => {
                starts.push(at);
                at += 1;
            }
            _ => at += link_len(&text[at..]).max(1),
        }
    }
    for (index, &start) in starts.iter().enumerate() {
        let end = starts.get(index + 1).copied().unwrap_or(text.len());
        let tag = &text[start + 1..end];
        let name_len = tag.iter().take_while(|&&c| is_identifier_part(c) || c == b'-').count();
        let (name, rest) = tag.split_at(name_len);
        tags.has_any = true;
        match name {
            b"deprecated" if tags.deprecated.is_none() => tags.deprecated = Some(tag_comment(rest)),
            b"inheritDoc" | b"inheritdoc" => tags.has_inherit_doc = true,
            b"typedef" | b"callback" => tags.has_typedef = true,
            b"param" | b"arg" | b"argument" | b"return" | b"returns" => tags.has_parameter_or_return = true,
            _ => {}
        }
    }
    tags
}

impl<'c, 'p, 's> Services<'c, 'p, 's> {
    /// Calls `then` with the text of `file`. That of a file of the default library is not kept.
    fn with_text<R>(&self, file: FileId, then: impl FnOnce(&[u8]) -> R) -> Option<R> {
        let module = self.c.files().module(file);
        if !module.hir.text.is_empty() {
            return Some(then(&module.hir.text));
        }
        let (mut then, mut result) = (Some(then), None);
        (self.read_library?)(module.file_name(), &mut |text| {
            if let Some(then) = then.take() {
                result = Some(then(text));
            }
        });
        result
    }

    /// `last(node.jsDoc)`
    fn tags_attached_to(&self, file: FileId, node: Node, text: &[u8]) -> Option<Tags> {
        let hir = self.c.hir(file);
        let kind = hir.kind(node);
        if !can_have_js_doc(kind) {
            return None;
        }
        // `node.pos`
        let pos = skip_trivia_back(text, hir.start(node) as usize);
        // `getJSDocCommentRanges`
        let mut ranges = match kind {
            Kind::Parameter
            | Kind::TypeParameter
            | Kind::FunctionExpression
            | Kind::ArrowFunction
            | Kind::ParenthesizedExpression
            | Kind::VariableDeclaration
            | Kind::ExportSpecifier => get_trailing_comment_ranges(text, pos),
            _ => Vec::new(),
        };
        ranges.extend(get_leading_comment_ranges(text, pos));
        let is_js_doc = |range: &&(usize, usize)| {
            let comment = text.get(range.0..range.1).unwrap_or_default();
            comment.starts_with(b"/**") && comment.get(3) != Some(&b'/')
        };
        let &(start, end) = ranges.iter().rfind(is_js_doc)?;
        Some(parse_tags(&text[start..end]))
    }

    /// `getNextJSDocCommentLocation`
    fn next_js_doc_comment_location(&self, file: FileId, node: Node) -> Node {
        let hir = self.c.hir(file);
        let is_assignment = |node: Node| matches!(hir.data(node), NodeData::Expr(e) if matches!(hir[e].kind, ExprKind::Assign { op: None, .. }));
        // `getSingleVariableOfVariableStatement`
        let single_variable = |statement: Node| match hir.data(statement) {
            NodeData::Stmt(s) => match hir[s].kind {
                StmtKind::Var(declarations) => declarations.iter().next().map_or(Node::NONE, |first| hir.node(first)),
                _ => Node::NONE,
            },
            _ => Node::NONE,
        };
        // `getSingleInitializerOfVariableStatementOrPropertyDeclaration`
        let single_initializer = |of: Node| match hir.kind(of) {
            Kind::VariableStatement => match single_variable(of) {
                Node::NONE => Node::NONE,
                variable => hir.initializer(variable),
            },
            Kind::PropertyDeclaration | Kind::PropertyAssignment => hir.initializer(of),
            _ => Node::NONE,
        };
        let parent = hir.parent(node);
        if parent.is_none() || parent == Node::FILE {
            return Node::NONE;
        }
        let is_at_parent = match hir.kind(parent) {
            Kind::PropertyAssignment | Kind::ExportAssignment | Kind::PropertyDeclaration | Kind::ReturnStatement => true,
            Kind::ExpressionStatement => hir.kind(node) == Kind::PropertyAccessExpression,
            Kind::ModuleDeclaration => hir.kind(node) == Kind::ModuleDeclaration,
            _ => false,
        };
        if is_at_parent || is_assignment(node) {
            return parent;
        }
        let grandparent = hir.parent(parent);
        if grandparent.is_none() || grandparent == Node::FILE {
            return Node::NONE;
        }
        if single_variable(grandparent) == node || is_assignment(parent) {
            return grandparent;
        }
        let great_grandparent = hir.parent(grandparent);
        if great_grandparent.is_none() || great_grandparent == Node::FILE {
            return Node::NONE;
        }
        if single_variable(great_grandparent).is_some() || single_initializer(great_grandparent) == node {
            return great_grandparent;
        }
        Node::NONE
    }

    /// `getJSDocTags(node)`
    fn js_doc_tags(&self, host: NodeRef) -> Tags {
        let Some((hir, at)) = self.valid(host) else {
            return Tags::default();
        };
        let collected = self.with_text(host.file, |text| {
            let mut tags = Tags::default();
            // A variable, a parameter or a property has those of its initializer too.
            let is_variable_like = matches!(
                hir.kind(at),
                Kind::BindingElement
                    | Kind::EnumMember
                    | Kind::Parameter
                    | Kind::PropertyAssignment
                    | Kind::PropertyDeclaration
                    | Kind::PropertySignature
                    | Kind::ShorthandPropertyAssignment
                    | Kind::VariableDeclaration
            );
            if is_variable_like
                && let Some(initializer) = Some(hir.initializer(at)).filter(|it| it.is_some())
                && let Some(found) = self.tags_attached_to(host.file, initializer, text)
            {
                tags.add(found);
            }
            let (mut node, mut depth) = (at, 0);
            while node.is_some() && node != Node::FILE && depth < 64 {
                if let Some(found) = self.tags_attached_to(host.file, node, text) {
                    tags.add(found);
                }
                if matches!(hir.kind(node), Kind::Parameter | Kind::TypeParameter) {
                    break;
                }
                node = self.next_js_doc_comment_location(host.file, node);
                depth += 1;
            }
            tags
        });
        collected.unwrap_or_default()
    }

    /// `getJsDocTagsOfDeclarations(declarations, checker)`
    fn js_doc_tags_of_declarations(&mut self, declarations: &[NodeRef], name: &[u8], depth: u32) -> Tags {
        // `getJsDocTagsFromDeclarations`
        let mut tags = Tags::default();
        for (index, &declaration) in declarations.iter().enumerate() {
            if declarations[..index].contains(&declaration) {
                continue;
            }
            let found = self.js_doc_tags(declaration);
            // "skip comments containing @typedefs since they're not associated with particular declarations"
            if !found.has_typedef || found.has_parameter_or_return {
                tags.add(found);
            }
        }
        if (tags.has_any && !tags.has_inherit_doc) || depth > 16 {
            return tags;
        }
        // Those that a member inherits come first.
        for &declaration in declarations {
            if let Some(mut inherited) = self.js_doc_tags_of_base_of_declaration(declaration, name, depth) {
                inherited.add(tags);
                tags = inherited;
            }
        }
        tags
    }

    /// `findBaseOfDeclaration`
    fn js_doc_tags_of_base_of_declaration(&mut self, declaration: NodeRef, name: &[u8], depth: u32) -> Option<Tags> {
        let (hir, at) = self.valid(declaration)?;
        let file = declaration.file;
        let parent = hir.parent(at);
        let container = match hir.kind(parent) {
            Kind::Constructor => hir.parent(parent),
            _ => parent,
        };
        if !matches!(hir.kind(container), Kind::ClassDeclaration | Kind::ClassExpression | Kind::InterfaceDeclaration) {
            return None;
        }
        let is_static = hir.flags(at).contains(Flags::STATIC);
        // `getAllSuperTypeNodes`
        let mut super_type_nodes: SmallVec<[Node; 4]> = SmallVec::new();
        hir.for_each_child(container, &mut |clause| {
            if hir.kind(clause) == Kind::HeritageClause {
                hir.for_each_child(clause, &mut |it| {
                    super_type_nodes.push(it);
                    false
                });
            }
            false
        });
        for node in super_type_nodes {
            let base_type = self.type_at_location(NodeRef { file, node });
            let ty = match self.symbol_of_type(base_type).filter(|_| is_static) {
                Some(symbol) => self.type_of_symbol(symbol),
                None => base_type,
            };
            let Some(symbol) = self.property_of_type(ty, name) else {
                continue;
            };
            let declarations = self.declarations(symbol);
            if declarations.len() == 1 {
                return Some(self.js_doc_tags_of_declarations(declarations, name, depth + 1));
            }
        }
        None
    }

    /// The text of the `@deprecated` tag among `getJSDocTags(node)`.
    pub fn deprecation_of_node(&mut self, node: NodeRef) -> Option<&'c [u8]> {
        let reason = self.js_doc_tags(node).deprecated?;
        Some(self.list(&reason))
    }

    /// The text of the `deprecated` one of `symbol.getJsDocTags(checker)`: of the first of its
    /// declarations that has one, or that it inherits.
    pub fn deprecation_of_symbol(&mut self, symbol: SymbolRef) -> Option<&'c [u8]> {
        let declarations = self.declarations(symbol);
        let name = self.symbol_info(symbol).name;
        let reason = self.js_doc_tags_of_declarations(declarations, name, 0).deprecated?;
        Some(self.list(&reason))
    }

    /// The same of `signature.getJsDocTags()`.
    pub fn deprecation_of_signature(&mut self, signature: SigId) -> Option<&'c [u8]> {
        let declaration = self.signature_info(signature).declaration?;
        let name = self.valid(declaration).map_or(Atom::NONE, |(hir, at)| hir.text(hir.name(at)));
        let name: &[u8] = match name {
            Atom::NONE => b"",
            name => self.c.atoms().bytes(name),
        };
        let reason = self.js_doc_tags_of_declarations(&[declaration], name, 0).deprecated?;
        Some(self.list(&reason))
    }
}
