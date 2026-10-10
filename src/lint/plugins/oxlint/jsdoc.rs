//! The node that a JSDoc comment belongs to (`JSDocBuilder` of oxc's `oxc_jsdoc`), and oxlint's `utils/jsdoc.rs` and
//! `config/settings/jsdoc.rs`. What is in a comment is read by [`File::jsdoc`].

use super::comments::{is_jsdoc_content, leading_comments};
use bun_core::strings;
use bun_lint::ast::jsdoc::{
    JSDocCommentPart, JSDocTagKindPart, JSDocTagTypeNamePart, JSDocTagTypePart, JSDocs,
};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

pub(crate) use bun_lint::ast::jsdoc::{JSDoc, JSDocTag};

struct Comment {
    /// Where the `/**` is.
    start: u32,
    /// Where the token after the comment starts.
    attached_to: u32,
}

/// The JSDoc comments of a file, in source order. It has positions only, so that it can be kept with the file.
struct Comments(Vec<Comment>);

impl Comments {
    fn new<'a>(file: &'a File<'a>) -> Comments {
        let is_jsdoc = |it: &(Token, u32)| {
            it.0.kind() == TokenKind::Block && is_jsdoc_content(it.0.comment_value())
        };
        let jsdoc = leading_comments(file).into_iter().filter(is_jsdoc);
        Comments(
            jsdoc
                .map(|it| Comment {
                    start: it.0.span().start,
                    attached_to: it.1,
                })
                .collect(),
        )
    }

    /// Those before the token that starts at `at`.
    fn attached_to(&self, at: u32) -> &[Comment] {
        let rest = self
            .0
            .get(self.0.partition_point(|it| it.attached_to < at)..)
            .unwrap_or_default();
        rest.get(..rest.partition_point(|it| it.attached_to == at))
            .unwrap_or_default()
    }

    fn has(&self, at: u32) -> bool {
        !self.attached_to(at).is_empty()
    }
}

/// The node of oxc's tree that `get_function_nearest_jsdoc_node` finds, if it has JSDoc comments.
#[derive(Copy, Clone)]
pub(crate) struct Attached<'a> {
    /// Where the node starts.
    at: u32,
    /// The node, if it is a `MethodDefinition`.
    pub(crate) method_definition: Option<Member<'a>>,
}

enum Kept<'a> {
    WithTheFile(&'a Comments),
    Here(Comments),
}

impl Kept<'_> {
    fn get(&self) -> &Comments {
        match self {
            Kept::WithTheFile(comments) => comments,
            Kept::Here(comments) => comments,
        }
    }
}

/// `ctx.jsdoc()`. The state of a rule.
pub struct JSDocFinder<'a> {
    docs: JSDocs<'a>,
    comments: Kept<'a>,
    nearest: AncestorMemo<'a, Option<Attached<'a>>>,
}

impl<'a> JSDocFinder<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        let has_comments = file.comments().next().is_some();
        let comments = match has_comments
            .then(|| file.extension(|| Comments::new(file)))
            .flatten()
        {
            Some(kept) => Kept::WithTheFile(kept),
            None => Kept::Here(Comments::new(file)),
        };
        JSDocFinder {
            docs: file.jsdoc(),
            comments,
            nearest: AncestorMemo::default(),
        }
    }

    fn comments(&self) -> &Comments {
        self.comments.get()
    }

    /// The file has no JSDoc comment.
    pub(crate) fn is_empty(&self) -> bool {
        self.comments().0.is_empty()
    }

    fn handles<'s>(
        &'s self,
        comments: &'s [Comment],
    ) -> impl DoubleEndedIterator<Item = JSDoc<'a>> + Clone {
        let docs = self.docs;
        comments.iter().filter_map(move |it| docs.at(it.start))
    }

    pub(crate) fn iter_all(&self) -> impl Iterator<Item = JSDoc<'a>> {
        self.handles(&self.comments().0)
    }

    pub(crate) fn get_all_by_node(
        &self,
        node: Attached,
    ) -> impl DoubleEndedIterator<Item = JSDoc<'a>> + Clone {
        self.handles(self.comments().attached_to(node.at))
    }

    /// [`JSDocFinder::iter_all`] without what `ignoreInternal` and `ignorePrivate` take out.
    pub(crate) fn iter_checked<'s>(
        &'s self,
        settings: &'s JSDocPluginSettings,
    ) -> impl Iterator<Item = JSDoc<'a>> {
        self.iter_all().filter(move |it| is_checked(*it, settings))
    }

    /// [`JSDocFinder::get_all_by_node`] without them.
    pub(crate) fn get_checked_by_node<'s>(
        &'s self,
        node: Attached,
        settings: &'s JSDocPluginSettings,
    ) -> impl Iterator<Item = JSDoc<'a>> {
        self.get_all_by_node(node)
            .filter(move |it| is_checked(*it, settings))
    }

    /// The comments of a function are often before something that the function is in: `/** .. */ const a = () => {}`.
    pub(crate) fn get_function_nearest_jsdoc_node(
        &mut self,
        func: Func<'a>,
    ) -> Option<Attached<'a>> {
        let comments = self.comments.get();
        let at = func.estree_span().start;
        match comments.has(at) {
            true => Some(Attached {
                at,
                method_definition: None,
            }),
            false => self
                .nearest
                .find(Node::Func(func), |child, parent| {
                    nearest_in(comments, child, parent)
                })
                .flatten(),
        }
    }
}

/// Whether the statement that `e` is in is an expression that starts at `at`, where `e`, or a parenthesis around it, starts. Then
/// the comments before belong to the statement: to the outermost node that starts there.
fn starts_expression_statement(e: Expr, at: u32) -> bool {
    let mut e = e;
    loop {
        match e.parent() {
            Node::Expr(parent) if parent.outer_span().start == at => e = parent,
            Node::Stmt(stmt) => return stmt.tag() == StmtTag::Expr && stmt.span().start == at,
            _ => return false,
        }
    }
}

/// A step of `get_function_nearest_jsdoc_node`, through the nodes that oxc has from `child`, without it, to `parent`, with it.
/// `None`: it goes on.
fn nearest_in<'a>(
    comments: &Comments,
    child: Node<'a>,
    parent: Node<'a>,
) -> Option<Option<Attached<'a>>> {
    let attached = |at: u32| {
        comments.has(at).then_some(Attached {
            at,
            method_definition: None,
        })
    };
    // A node that can have comments and that it goes on from, and one that it ends at.
    let passed = |at: u32| attached(at).map(Some);
    let last = |at: u32| Some(attached(at));
    if let Node::Expr(e) = child
        && e.is_parenthesized()
        && let Some(paren) = e
            .parens()
            .find(|it| comments.has(it.start) && !starts_expression_statement(e, it.start))
    {
        return last(paren.start);
    }
    match parent {
        Node::File(_) => Some(None),
        Node::Func(func) if func.kind() == FnKind::StaticBlock => None,
        Node::Func(func) => {
            let at = func.estree_span().start;
            Some(attached(at).filter(
                |_| !matches!(func.owner(), Node::Expr(e) if starts_expression_statement(e, at)),
            ))
        }
        Node::Expr(e) => match e.tag() {
            ExprTag::Object => last(e.span().start),
            ExprTag::Call | ExprTag::New => match e.parent() {
                Node::Stmt(stmt)
                    if stmt.tag() == StmtTag::ExportDefault
                        && !e.is_parenthesized()
                        && !e.is_chain_root() =>
                {
                    last(stmt.span().start)
                }
                _ => Some(None),
            },
            _ => None,
        },
        Node::Prop(prop) if prop.is_jsx_attribute() || prop.kind() == PropKind::Spread => None,
        Node::Prop(prop) => passed(prop.span().start),
        Node::VarDecl(declarator) => passed(declarator.span().start),
        Node::Param(param) => passed(param.span().start),
        Node::Case(case) => passed(case.span().start),
        Node::Class(class) => passed(class.estree_span().start),
        Node::Member(member) if member.is_signature() => None,
        Node::Member(member) => match member.kind() {
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor => Some(attached(member.span().start).map(|it| Attached {
                method_definition: Some(member),
                ..it
            })),
            MemberKind::Property if !member.flags().contains(Flags::ACCESSOR) => {
                last(member.span().start)
            }
            MemberKind::StaticBlock => passed(member.span().start),
            _ => None,
        },
        Node::Stmt(stmt) => {
            let is_export = stmt.is_exported() || stmt.is_default_export();
            match stmt.kind() {
                StmtKind::Var(_) => match attached(stmt.span_without_export().start) {
                    None if is_export => last(stmt.span().start),
                    found => Some(found),
                },
                StmtKind::Return(_) => last(stmt.span().start),
                // The declaration is the `Func` or the `Class`, and those of TypeScript have no comments.
                StmtKind::Fn(_)
                | StmtKind::Class(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportAssign(_)
                | StmtKind::ExportAsNamespace(_)
                    if !is_export =>
                {
                    None
                }
                StmtKind::Try { param, handler, .. }
                    if handler.map(Node::Stmt) == Some(child)
                        || param.map(Node::VarDecl) == Some(child) =>
                {
                    stmt.catch_clause_span()
                        .and_then(|it| passed(it.start))
                        .or_else(|| passed(stmt.span().start))
                }
                _ => passed(stmt.span().start),
            }
        }
        _ => None,
    }
}

/// What oxc calls a function. `None`: it is no `Function` and no `ArrowFunctionExpression` there.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum FunctionType {
    FunctionDeclaration,
    FunctionExpression,
    TSDeclareFunction,
    TSEmptyBodyFunctionExpression,
    ArrowFunctionExpression,
}

pub(crate) fn function_type(func: Func) -> Option<FunctionType> {
    match func.kind() {
        FnKind::Arrow => Some(FunctionType::ArrowFunctionExpression),
        FnKind::Decl if func.has_body() => Some(FunctionType::FunctionDeclaration),
        FnKind::Decl => Some(FunctionType::TSDeclareFunction),
        FnKind::Expr => Some(FunctionType::FunctionExpression),
        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
            match func.owner() {
                Node::Member(member) if member.is_signature() => None,
                _ if func.has_body() => Some(FunctionType::FunctionExpression),
                _ => Some(FunctionType::TSEmptyBodyFunctionExpression),
            }
        }
        _ => None,
    }
}

/// `f.is_function_declaration() || f.is_expression()`, or an arrow function.
pub(crate) fn is_function_declaration_or_expression(func: Func) -> bool {
    function_type(func).is_some_and(|it| it != FunctionType::TSDeclareFunction)
}

/// `!func.is_typescript_syntax()`, or an arrow function.
pub(crate) fn is_function_with_body(func: Func) -> bool {
    func.has_body() && function_type(func).is_some()
}

/// `settings.jsdoc`
pub(crate) struct JSDocPluginSettings<'a> {
    pub(crate) ignore_private: bool,
    pub(crate) ignore_internal: bool,
    ignore_replaces_docs: bool,
    override_replaces_docs: bool,
    augments_extends_replaces_docs: bool,
    implements_replaces_docs: bool,
    pub(crate) exempt_destructured_roots_from_checks: bool,
    tag_name_preference: Object<'a>,
}

impl<'a> JSDocPluginSettings<'a> {
    pub(crate) fn new(file: &File<'a>) -> Self {
        let settings = Object::of(file.settings().get(b"jsdoc"));
        JSDocPluginSettings {
            ignore_private: settings.bool_or("ignorePrivate", false),
            ignore_internal: settings.bool_or("ignoreInternal", false),
            ignore_replaces_docs: settings.bool_or("ignoreReplacesDocs", true),
            override_replaces_docs: settings.bool_or("overrideReplacesDocs", true),
            augments_extends_replaces_docs: settings.bool_or("augmentsExtendsReplacesDocs", false),
            implements_replaces_docs: settings.bool_or("implementsReplacesDocs", false),
            exempt_destructured_roots_from_checks: settings
                .bool_or("exemptDestructuredRootsFromChecks", false),
            tag_name_preference: settings.object("tagNamePreference"),
        }
    }

    fn preference(&self, tag_name: &[u8]) -> Option<&'a Json> {
        self.tag_name_preference
            .entries()
            .iter()
            .find(|it| it.0 == tag_name)
            .map(|it| &it.1)
    }

    /// `"name"`, `{ "message": .., "replacement": "name" }`
    fn replacement(preference: &Json) -> Option<&[u8]> {
        preference.as_str().or_else(|| {
            preference
                .get(b"message")
                .and_then(|_| preference.get(b"replacement"))?
                .as_str()
        })
    }

    /// `false`, `{ "message": .. }`
    pub(crate) fn is_blocked_tag_name(&self, tag_name: &[u8]) -> bool {
        self.preference(tag_name)
            .is_some_and(|it| Self::replacement(it).is_none())
    }

    /// The name that JSDoc prefers.
    fn default_alias(original_name: &[u8]) -> Option<&'static str> {
        Some(match original_name {
            b"virtual" => "abstract",
            b"extends" => "augments",
            b"constructor" => "class",
            b"const" => "constant",
            b"defaultvalue" => "default",
            b"desc" => "description",
            b"host" => "external",
            b"fileoverview" | b"overview" => "file",
            b"emits" => "fires",
            b"func" | b"method" => "function",
            b"var" => "member",
            b"arg" | b"argument" => "param",
            b"prop" => "property",
            b"return" => "returns",
            b"exception" => "throws",
            b"yield" => "yields",
            _ => return None,
        })
    }

    /// The configuration, or JSDoc, has another name for the tag.
    pub(crate) fn has_preferred_tag_name(&self, original_name: &[u8]) -> bool {
        self.preference(original_name).is_some() || Self::default_alias(original_name).is_some()
    }

    /// What oxlint says against a tag that [is blocked](Self::is_blocked_tag_name) or
    /// [has another name](Self::has_preferred_tag_name).
    pub(crate) fn reason_against_tag_name(&self, tag_name: &[u8]) -> Option<String> {
        let name = bstr::BStr::new(tag_name);
        let replace_with = |preferred: &[u8]| {
            let preferred = bstr::BStr::new(preferred);
            format!("Replace tag `@{name}` with `@{preferred}`.")
        };
        let Some(preference) = self.preference(tag_name) else {
            return Self::default_alias(tag_name).map(|it| replace_with(it.as_bytes()));
        };
        let message = preference.get(b"message").and_then(Json::as_str);
        Some(match (message, preference.as_str()) {
            (Some(message), _) => bstr::BStr::new(message).to_string(),
            (None, Some(preferred)) => replace_with(preferred),
            (None, None) => format!("Unexpected tag `@{name}`."),
        })
    }

    /// `list_user_defined_tag_names().contains(tag_name)`
    pub(crate) fn is_user_defined_tag_name(&self, tag_name: &[u8]) -> bool {
        self.tag_name_preference
            .entries()
            .iter()
            .any(|it| Self::replacement(&it.1) == Some(tag_name))
    }

    /// The name that the configuration has for a tag of JSDoc.
    pub(crate) fn resolve_tag_name(&self, original_name: &'a str) -> &'a [u8] {
        self.preference(original_name.as_bytes())
            .and_then(Self::replacement)
            .unwrap_or(original_name.as_bytes())
    }
}

pub(crate) fn should_ignore_as_custom_skip(jsdoc: JSDoc) -> bool {
    let mut kinds = jsdoc.tags().map(|tag| tag.kind.parsed());
    kinds.any(|it| {
        matches!(
            it,
            b"abstract" | b"class" | b"constructor" | b"interface" | b"type" | b"virtual"
        )
    })
}

pub(crate) fn is_missing_special_tag<'s>(
    mut jsdoc_tags: impl Iterator<Item = JSDocTag<'s>>,
    resolved_tag_name: &[u8],
) -> bool {
    jsdoc_tags.all(|tag| tag.kind.parsed() != resolved_tag_name)
}

/// The second tag of that name.
pub(crate) fn is_duplicated_special_tag<'s>(
    jsdoc_tags: impl Iterator<Item = JSDocTag<'s>>,
    resolved_tag_name: &[u8],
) -> Option<Span> {
    jsdoc_tags
        .filter(|tag| tag.kind.parsed() == resolved_tag_name)
        .nth(1)
        .map(|tag| tag.kind.span)
}

pub(crate) fn should_ignore_as_internal(jsdoc: JSDoc, settings: &JSDocPluginSettings) -> bool {
    settings.ignore_internal && {
        let resolved_internal_tag_name = settings.resolve_tag_name("internal");
        jsdoc
            .tags()
            .any(|tag| tag.kind.parsed() == resolved_internal_tag_name)
    }
}

pub(crate) fn should_ignore_as_private(jsdoc: JSDoc, settings: &JSDocPluginSettings) -> bool {
    settings.ignore_private && {
        let resolved_private_tag_name = settings.resolve_tag_name("private");
        let resolved_access_tag_name = settings.resolve_tag_name("access");
        jsdoc.tags().any(|tag| {
            let tag_name = tag.kind.parsed();
            tag_name == resolved_private_tag_name
                || tag_name == resolved_access_tag_name
                    && tag
                        .comment()
                        .single_line()
                        .is_some_and(|it| it == b"private")
        })
    }
}

fn is_checked(jsdoc: JSDoc, settings: &JSDocPluginSettings) -> bool {
    !should_ignore_as_internal(jsdoc, settings) && !should_ignore_as_private(jsdoc, settings)
}

pub(crate) fn should_ignore_as_avoid(
    jsdoc: JSDoc,
    settings: &JSDocPluginSettings,
    exempted_tag_names: &[Box<[u8]>],
) -> bool {
    let replaces_docs = [
        (settings.ignore_replaces_docs, "ignore"),
        (settings.override_replaces_docs, "override"),
        (settings.augments_extends_replaces_docs, "augments"),
        (settings.augments_extends_replaces_docs, "extends"),
        (settings.implements_replaces_docs, "implements"),
    ];
    jsdoc.tags().map(|tag| tag.kind.parsed()).any(|tag_name| {
        exempted_tag_names.iter().any(|it| **it == *tag_name)
            || replaces_docs
                .iter()
                .any(|it| it.0 && settings.resolve_tag_name(it.1) == tag_name)
    })
}

/// A `@param`, for `require-param-type` and `require-param-description`.
pub(crate) struct ParamTag<'s> {
    pub(crate) kind: JSDocTagKindPart<'s>,
    pub(crate) type_part: Option<JSDocTagTypePart<'s>>,
    pub(crate) name_part: Option<JSDocTagTypeNamePart<'s>>,
    pub(crate) comment_part: JSDocCommentPart<'s>,
    /// The parameter that it is about is destructured. The n-th name before a `.` is about the n-th parameter.
    pub(crate) is_about_nested_param: bool,
    /// It has a name, without a `.`.
    pub(crate) is_current_root_tag: bool,
}

pub(crate) fn param_tags<'s>(
    jsdocs: impl Iterator<Item = JSDoc<'s>>,
    func: Func,
    resolved_param_tag_name: &[u8],
) -> impl Iterator<Item = ParamTag<'s>> {
    let mut root_names: FxHashMap<&[u8], usize> = FxHashMap::default();
    let is_destructured: SmallVec<[bool; 8]> = func
        .params()
        .iter()
        .map(|it| it.pat().tag() != PatTag::Ident)
        .collect();
    jsdocs
        .flat_map(JSDoc::tags)
        .filter(move |tag| tag.kind.parsed() == resolved_param_tag_name)
        .map(move |tag| {
            let (type_part, name_part, comment_part) = tag.type_name_comment();
            let (is_about_nested_param, is_current_root_tag) =
                name_part.map_or((false, false), |name_part| {
                    let name = name_part.parsed();
                    let mut root_name =
                        strings::split_once_char(name, b'.').map_or(name, |it| it.0);
                    while let Some(rest) = root_name.strip_suffix(b"[]") {
                        root_name = rest;
                    }
                    let next_index = root_names.len();
                    let current_param = *root_names.entry(root_name).or_insert(next_index);
                    (
                        is_destructured.get(current_param) == Some(&true),
                        name == root_name,
                    )
                });
            ParamTag {
                kind: tag.kind,
                type_part,
                name_part,
                comment_part,
                is_about_nested_param,
                is_current_root_tag,
            }
        })
}

pub(crate) struct ParamInfo {
    pub(crate) span: Span,
    pub(crate) name: Vec<u8>,
    pub(crate) is_rest: bool,
}

pub(crate) enum ParamKind {
    Single(ParamInfo),
    Nested(Vec<ParamInfo>),
}

enum Collect<'a> {
    Param(ParamInfo),
    /// What `pat`, and the object that is its default value, name. Each name comes after `prefix`.
    Nested {
        pat: Pat<'a>,
        default: Option<Expr<'a>>,
        prefix: Vec<u8>,
    },
}

/// `limit`: no more than this many bytes of a name in a destructured parameter are needed.
pub(crate) fn collect_params(
    func: Func,
    use_default_object_properties: bool,
    limit: usize,
) -> Vec<ParamKind> {
    let join = |prefix: &[u8], name: &[u8], suffix: &[u8]| -> Vec<u8> {
        prefix
            .iter()
            .chain(name)
            .chain(suffix)
            .copied()
            .take(limit)
            .collect()
    };
    let default_object = |default: Option<Expr<'_>>| -> bool {
        use_default_object_properties
            && default.is_some_and(|it| it.tag() == ExprTag::Object && !it.is_parenthesized())
    };
    let collect_nested = |pat: Pat<'_>| -> Vec<ParamInfo> {
        let mut collected = Vec::new();
        let mut pending = vec![Collect::Nested {
            pat,
            default: None,
            prefix: Vec::new(),
        }];
        while let Some(next) = pending.pop() {
            let (pat, default, prefix) = match next {
                Collect::Param(param) => {
                    collected.push(param);
                    continue;
                }
                Collect::Nested {
                    pat,
                    default,
                    prefix,
                } => (pat, default, prefix),
            };
            let first = pending.len();
            let single = |name: Vec<u8>, pat: Pat, is_rest: bool| {
                Collect::Param(ParamInfo {
                    span: pat.span(),
                    name,
                    is_rest,
                })
            };
            match pat.kind() {
                PatKind::Missing => {}
                PatKind::Ident(name) => {
                    pending.push(single(join(&prefix, name.bytes(), b""), pat, false))
                }
                PatKind::Object(properties) => {
                    for property in properties {
                        let (value, default) = (property.value(), property.default());
                        let is_single = value.tag() == PatTag::Ident && !default_object(default);
                        if property.is_rest() {
                            pending.push(match value.as_ident() {
                                Some(name) => single(join(&prefix, name.bytes(), b""), value, true),
                                None => Collect::Nested {
                                    pat: value,
                                    default: None,
                                    prefix: prefix.clone(),
                                },
                            });
                        } else if let Some(name) = property.key().and_then(Key::name) {
                            let at = if is_single {
                                value.span()
                            } else {
                                property.span()
                            };
                            let name_of_this = join(&prefix, name.bytes(), b"");
                            pending.push(Collect::Param(ParamInfo {
                                span: at,
                                name: name_of_this,
                                is_rest: false,
                            }));
                            if !is_single {
                                pending.push(Collect::Nested {
                                    pat: value,
                                    default,
                                    prefix: join(&prefix, name.bytes(), b"."),
                                });
                            }
                        }
                    }
                }
                PatKind::Array(elements) => {
                    for (idx, element) in elements.iter().enumerate() {
                        let Some(value) = element.pat() else {
                            continue;
                        };
                        let default = element.default().filter(|_| !element.is_rest());
                        pending.push(match value.as_ident() {
                            Some(name) if element.is_rest() => {
                                single(join(&prefix, name.bytes(), b""), value, true)
                            }
                            Some(_) if !default_object(default) => single(
                                join(&prefix, format!("\"{idx}\"").as_bytes(), b""),
                                value,
                                false,
                            ),
                            _ => Collect::Nested {
                                pat: value,
                                default,
                                prefix: prefix.clone(),
                            },
                        });
                    }
                }
            }
            if default_object(default)
                && let Some(ExprKind::Object(properties)) = default.map(Expr::kind)
            {
                for key in properties.iter().filter_map(Prop::key) {
                    if let KeyKind::Ident(name) = key.kind() {
                        let span = key.span(pat.file());
                        pending.push(Collect::Param(ParamInfo {
                            span,
                            name: join(&prefix, name.bytes(), b""),
                            is_rest: false,
                        }));
                    }
                }
            }
            if let Some(added) = pending.get_mut(first..) {
                added.reverse();
            }
        }
        collected
    };
    let kind_of = |param: Param<'_>| match param.pat().as_ident() {
        Some(name) => ParamKind::Single(ParamInfo {
            span: param.pat().span(),
            name: name.bytes().to_vec(),
            is_rest: param.is_rest(),
        }),
        None => ParamKind::Nested(collect_nested(param.pat())),
    };
    func.params().iter().map(kind_of).collect()
}
