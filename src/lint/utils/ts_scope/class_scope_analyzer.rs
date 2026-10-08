//! typescript-eslint's `util/class-scope-analyzer/`: how often the members of each class are read
//! and written from inside the class.
//!
//! The members of all classes are one vector, in which each class has a range. Only the classes
//! are walked, since nothing outside of a class is counted, and only if a member is tracked.

use super::estree::is_expression_statement;
use super::{Variable, is_variable_declarator_definition};
use crate::ast::{
    Class, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Key, KeyKind, List, Member,
    MemberKind, Name, Node, Param, Pat, PatKind, PropKind, TypeKind, TypeNode, UnOp,
};
use crate::semantic::Declaration;
use crate::span::Span;
use crate::tokens::{skip_trivia, skip_trivia_back, token_len};
use crate::utils::estree_compat::{estree_span, is_assignment_target};
use crate::utils::text::number_to_string;
use bun_sema::hir;
use std::borrow::Cow;

// ───────────────────────────── names ─────────────────────────────

/// typescript-eslint's `ExtractedName`. Its `key` is `code_name` with `is_private`: `#a` and
/// `["#a"]` are different members.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ExtractedName<'a> {
    /// `codeName`: the name as a message shows it. That of `#a` includes the `#`.
    pub code_name: Cow<'a, [u8]>,
    /// The name is a `PrivateIdentifier`.
    pub is_private: bool,
    /// The range of `nameNode`. For `["a"]` it is that of the string, for a parameter property it
    /// includes the type annotation.
    pub name_span: Span,
}

/// typescript-eslint's `extractComputedName`: the name that a literal or a template without
/// substitutions in brackets stands for.
fn extract_computed_name(computed_name: Expr<'_>) -> Option<ExtractedName<'_>> {
    let code_name = match computed_name.kind() {
        ExprKind::String(value) => Cow::Borrowed(value.bytes()),
        ExprKind::Number(value) => Cow::Owned(number_to_string(value)),
        ExprKind::BigInt(value) => {
            let digits = value.bytes();
            Cow::Borrowed(digits.strip_suffix(b"n").unwrap_or(digits))
        },
        ExprKind::True => Cow::Borrowed(&b"true"[..]),
        ExprKind::False => Cow::Borrowed(&b"false"[..]),
        ExprKind::Null => Cow::Borrowed(&b"null"[..]),
        ExprKind::Regex(_) => Cow::Borrowed(computed_name.text()),
        ExprKind::Template(template) if template.exprs().is_empty() => {
            Cow::Borrowed(template.raw(0))
        }
        _ => return None,
    };
    Some(ExtractedName {
        code_name,
        is_private: false,
        name_span: computed_name.span(),
    })
}

fn extract_name_for_key<'a>(file: &'a File<'a>, key: Key<'a>) -> Option<ExtractedName<'a>> {
    let whole = key.span(file);
    let (name, name_span) = match key.kind() {
        KeyKind::Computed(e) => return extract_computed_name(e),
        KeyKind::ComputedString(name) | KeyKind::ComputedNumber(name) => {
            let text = file.text();
            let start = skip_trivia(text, whole.start + 1);
            (name, Span::new(start, skip_trivia_back(text, whole.end.saturating_sub(1))))
        }
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::Private(name) => (name, whole),
    };
    Some(ExtractedName {
        code_name: Cow::Borrowed(name.bytes()),
        is_private: key.is_private(),
        name_span,
    })
}

/// typescript-eslint's `extractNameForMember`. `None` if it takes evaluating an expression to know
/// the name.
pub fn extract_name_for_member(node: MemberNode<'_>) -> Option<ExtractedName<'_>> {
    match node {
        // `static constructor() {}`, which is a method in ESTree.
        MemberNode::Member(member) if member.kind() == MemberKind::Constructor => {
            let text = member.file().text();
            let start = member.span().start;
            let start = skip_trivia(text, member.modifiers().last().map_or(start, |it| it.span().end));
            let len = token_len(text.get(start as usize..).unwrap_or_default());
            Some(ExtractedName {
                code_name: Cow::Borrowed(b"constructor"),
                is_private: false,
                name_span: Span::new(start, start + len as u32),
            })
        }
        MemberNode::Member(member) => extract_name_for_key(member.file(), member.key()?),
        MemberNode::ParameterProperty(param) => Some(ExtractedName {
            code_name: Cow::Borrowed(param.pat().as_ident()?.bytes()),
            is_private: false,
            name_span: estree_span(Node::Pat(param.pat())),
        }),
    }
}

/// typescript-eslint's `extractNameForMemberExpression`, of a `Dot` or an `Index`.
pub fn extract_name_for_member_expression(node: Expr<'_>) -> Option<ExtractedName<'_>> {
    match node.kind() {
        ExprKind::Index { index, .. } => extract_computed_name(index),
        ExprKind::Dot { name, .. } => Some(ExtractedName {
            code_name: Cow::Borrowed(name.bytes()),
            is_private: name.bytes().starts_with(b"#"),
            name_span: name.span(),
        }),
        _ => None,
    }
}

// ───────────────────────────── members ─────────────────────────────

/// typescript-eslint's `MemberNode`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MemberNode<'a> {
    /// A property, a method or an accessor.
    Member(Member<'a>),
    /// `constructor(private a)`
    ParameterProperty(Param<'a>),
}

/// typescript-eslint's `Member` of `classScopeAnalyzer`.
#[derive(Clone, Debug)]
pub struct ClassMember<'a> {
    pub node: MemberNode<'a>,
    /// `name`, `key` and `nameNode`.
    pub name: ExtractedName<'a>,
    pub write_count: u32,
    pub read_count: u32,
}

impl<'a> ClassMember<'a> {
    fn create(node: MemberNode<'a>) -> Option<Self> {
        Some(ClassMember {
            node,
            name: extract_name_for_member(node)?,
            write_count: 0,
            read_count: 0,
        })
    }

    fn flags(&self) -> Flags {
        match self.node {
            MemberNode::Member(member) => member.flags(),
            MemberNode::ParameterProperty(param) => param.flags(),
        }
    }

    /// `get a()`, `set a(v)`, `accessor a`
    pub fn is_accessor(&self) -> bool {
        match self.node {
            MemberNode::Member(member) => match member.kind() {
                MemberKind::Getter | MemberKind::Setter => true,
                _ => member.flags().contains(Flags::ACCESSOR),
            },
            MemberNode::ParameterProperty(_) => false,
        }
    }

    /// `#a`
    #[inline]
    pub fn is_hash_private(&self) -> bool {
        self.name.is_private
    }

    /// `private a`
    #[inline]
    pub fn is_private(&self) -> bool {
        self.flags().contains(Flags::PRIVATE)
    }

    #[inline]
    pub fn is_static(&self) -> bool {
        self.flags().contains(Flags::STATIC)
    }

    /// It is read. For an accessor, which can have side effects, a write is a use too.
    pub fn is_used(&self) -> bool {
        self.read_count > 0 || (self.write_count > 0 && self.is_accessor())
    }
}

/// typescript-eslint's `ClassScopeResult`. The members are
/// [`ClassMemberUsage::members_of`] the class.
#[derive(Copy, Clone, Debug)]
pub struct ClassScopeResult<'a> {
    pub class: Class<'a>,
    /// `None` for an anonymous class.
    pub class_name: Option<Name<'a>>,
    first_member: u32,
    member_count: u32,
}

/// What typescript-eslint's `analyzeClassMemberUsage` returns.
#[derive(Debug, Default)]
pub struct ClassMemberUsage<'a> {
    /// By `ClassId`.
    classes: Vec<ClassScopeResult<'a>>,
    members: Vec<ClassMember<'a>>,
}

impl<'a> ClassMemberUsage<'a> {
    /// `result.values()`
    #[inline]
    pub fn classes(&self) -> &[ClassScopeResult<'a>] {
        &self.classes
    }

    /// `result.get(class)`
    #[inline]
    pub fn get(&self, class: Class<'a>) -> Option<&ClassScopeResult<'a>> {
        self.classes.get(class.id().idx())
    }

    /// `members.instance` and `members.static` of a class, told apart by
    /// [`ClassMember::is_static`]. Of the members with the same name, only the last is one.
    pub fn members_of(&self, class: &ClassScopeResult<'a>) -> &[ClassMember<'a>] {
        let first = class.first_member as usize;
        self.members.get(first..first + class.member_count as usize).unwrap_or_default()
    }

    /// The members of all the classes.
    #[inline]
    pub fn members(&self) -> &[ClassMember<'a>] {
        &self.members
    }

    /// `members.static.get(key)` or `members.instance.get(key)`, as an index.
    fn find(&self, class: u32, is_static: bool, name: &[u8], is_private: bool) -> Option<usize> {
        let class = self.classes.get(class as usize)?;
        let at = self.members_of(class).iter().position(|member| {
            member.name.is_private == is_private
                && *member.name.code_name == *name
                && member.is_static() == is_static
        })?;
        Some(class.first_member as usize + at)
    }

    /// What the constructor of upstream's `ClassScope` does.
    fn add_class(&mut self, class: Class<'a>, is_tracked: &impl Fn(&ClassMember<'a>) -> bool) {
        let first = self.members.len();
        let mut add = |node: MemberNode<'a>| {
            let Some(member) = ClassMember::create(node) else {
                return;
            };
            let same = self.members.get_mut(first..).unwrap_or_default().iter_mut().find(|it| {
                it.name.is_private == member.name.is_private
                    && it.name.code_name == member.name.code_name
                    && it.is_static() == member.is_static()
            });
            match same {
                Some(same) => *same = member,
                None => self.members.push(member),
            }
        };
        for member in class.members() {
            match member.kind() {
                MemberKind::Constructor if !member.is_static() => {
                    let params = member.func().map(Func::params).into_iter().flatten();
                    params
                        .filter(|param| param.is_parameter_property())
                        .for_each(|param| add(MemberNode::ParameterProperty(param)));
                }
                MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => add(MemberNode::Member(member)),
                _ => {}
            }
        }
        let mut kept = first;
        for at in first..self.members.len() {
            if self.members.get(at).is_some_and(is_tracked) {
                self.members.swap(kept, at);
                kept += 1;
            }
        }
        self.members.truncate(kept);
        self.classes.push(ClassScopeResult {
            class,
            class_name: class.name().map(|name| name.name()),
            first_member: first as u32,
            member_count: (kept - first) as u32,
        });
    }
}

// ───────────────────────────── references ─────────────────────────────

/// What upstream's `countReference` counts as a write: `node`, the access to the member, is only
/// assigned to. `a.b += 1` and `a.b++` are writes if nothing takes their value.
fn is_write_only_usage(node: Expr) -> bool {
    let is_statement = |e: Expr| matches!(e.parent(), Node::Stmt(it) if is_expression_statement(it));
    match node.parent().as_expr().map(|parent| (parent, parent.kind())) {
        Some((parent, ExprKind::Assign { op: Some(_), target, .. })) if target == node => {
            is_statement(parent)
        }
        Some((
            parent,
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            },
        )) => is_statement(parent),
        _ => is_assignment_target(node),
    }
}

const NONE: u32 = u32::MAX;

/// Upstream's `ThisScope`: a class, or what rebinds `this` in it.
#[derive(Copy, Clone)]
struct ThisScope {
    /// The class, for a `ClassScope`.
    class: u32,
    /// `thisContext`: the class whose instance or constructor `this` is.
    this_context: u32,
    is_static_this_context: bool,
}

struct Analyzer<'a> {
    usage: ClassMemberUsage<'a>,
    /// The current scope is the last, its `upper` the one before.
    scopes: Vec<ThisScope>,
}

impl<'a> Analyzer<'a> {
    fn find_class_scope_with_name(&self, name: Name<'a>) -> Option<u32> {
        let classes = self.scopes.iter().rev().map(|scope| scope.class);
        classes.filter(|&class| class != NONE).find(|&class| {
            self.usage.classes.get(class as usize).is_some_and(|it| it.class_name == Some(name))
        })
    }

    /// The class that `this` belongs to here, and whether it is the class itself.
    fn this_class(&self) -> Option<(u32, bool)> {
        let scope = self.scopes.last().filter(|scope| scope.this_context != NONE)?;
        Some((scope.this_context, scope.is_static_this_context))
    }

    /// The class that an annotation `Foo` or `typeof Foo` names, and whether it is the class
    /// itself.
    fn class_of_annotation(&self, ty: TypeNode<'a>) -> Option<(u32, bool)> {
        match ty.kind() {
            TypeKind::Ref { name, .. } => {
                Some((self.find_class_scope_with_name(name.as_ident()?.name())?, false))
            }
            TypeKind::Typeof { expr, .. } => {
                Some((self.find_class_scope_with_name(expr.as_ident()?)?, true))
            }
            _ => None,
        }
    }

    /// Upstream's `getObjectClass`, of the object of a member access.
    fn get_object_class(&self, object: Expr<'a>) -> Option<(u32, bool)> {
        let name = match object.kind() {
            ExprKind::This => return self.this_class(),
            ExprKind::Ident(name) => name,
            _ => return None,
        };
        if let Some(class) = self.find_class_scope_with_name(name) {
            return Some((class, true));
        }
        let symbol = object.symbol()?;
        let first = Variable::new(symbol).defs().next()?;
        match first {
            // `const self = this`
            Declaration::Var(_) if is_variable_declarator_definition(first) => {
                let Some(Node::VarDecl(declarator)) = first.node() else {
                    return None;
                };
                if declarator.init()?.tag() != ExprTag::This
                    || symbol.references().any(|it| it.is_write() && !it.is_init())
                {
                    return None;
                }
                self.this_class()
            }
            Declaration::Var(pat) => match pat.parent() {
                Node::VarDecl(declarator) => self.class_of_annotation(declarator.ty()?),
                _ => None,
            },
            // `method(thing: Foo)`
            Declaration::Param(pat) => match pat.parent() {
                Node::Param(param) if !param.is_rest() => self.class_of_annotation(param.ty()?),
                _ => None,
            },
            _ => None,
        }
    }

    fn count_reference(&mut self, member: usize, is_write: bool) {
        if let Some(member) = self.usage.members.get_mut(member) {
            match is_write {
                true => member.write_count += 1,
                false => member.read_count += 1,
            }
        }
    }

    /// `a.b`, `a["b"]`
    fn member_expression(&mut self, node: Expr<'a>, object: Expr<'a>) {
        if let Some(name) = extract_name_for_member_expression(node)
            && let Some((class, is_static)) = self.get_object_class(object)
            && let Some(member) = self.usage.find(class, is_static, &name.code_name, false)
        {
            self.count_reference(member, is_write_only_usage(node));
        }
    }

    /// `#name`, in `parent` if that is an expression.
    fn private_identifier(&mut self, name: Name<'a>, parent: Option<Expr<'a>>) {
        let contexts = self.scopes.iter().rev().map(|scope| scope.this_context);
        let member = contexts.filter(|&class| class != NONE).find_map(|class| {
            let find = |is_static| self.usage.find(class, is_static, name.bytes(), true);
            find(false).or_else(|| find(true))
        });
        if let Some(member) = member {
            self.count_reference(member, parent.is_some_and(is_write_only_usage));
        }
    }

    /// Upstream's `handleThisDestructuring`: `{ name } = this` reads the member.
    fn this_destructuring(&mut self, keys: impl Iterator<Item = Option<Key<'a>>>) {
        let Some((class, is_static)) = self.this_class() else {
            return;
        };
        for key in keys.flatten() {
            if let KeyKind::Ident(name) = key.kind()
                && let Some(member) = self.usage.find(class, is_static, name.bytes(), false)
            {
                self.count_reference(member, false);
            }
        }
    }

    /// `pat = value`, in a declaration, a parameter or a pattern.
    fn binding(&mut self, pat: Option<Pat<'a>>, value: Option<Expr<'a>>) {
        if value.is_some_and(|value| value.tag() == ExprTag::This)
            && let Some(PatKind::Object(props)) = pat.map(Pat::kind)
        {
            self.this_destructuring(props.iter().filter(|it| !it.is_rest()).map(|it| it.key()));
        }
    }

    /// Upstream's `IntermediateScope`, for a function with a body or a static block.
    fn scope_of_function(&self, func: Func<'a>) -> ThisScope {
        let upper = self.scopes.last().map_or(NONE, |scope| scope.class);
        let scope = |this_context, is_static_this_context| ThisScope {
            class: NONE,
            this_context,
            is_static_this_context,
        };
        if func.kind() == FnKind::StaticBlock {
            return scope(upper, true);
        }
        let member = match func.owner() {
            Node::Member(member) => Some(member),
            Node::Expr(e) => match e.parent() {
                Node::Member(member)
                    if member.init() == Some(e) && !member.flags().contains(Flags::ACCESSOR) =>
                {
                    Some(member)
                }
                _ => None,
            },
            _ => None,
        };
        if let Some(member) = member {
            return scope(upper, member.is_static());
        }
        let this_type = func.this_param().and_then(Param::ty).map(TypeNode::kind);
        if let Some(TypeKind::Ref { name, .. }) = this_type
            && let Some(name) = name.as_ident()
            && let Some(class) = self.find_class_scope_with_name(name.name())
        {
            return scope(class, false);
        }
        scope(NONE, false)
    }

    fn visit_children(&mut self, node: Node<'a>) {
        node.for_each_child(|child| self.visit(child));
    }

    fn visit_all(&mut self, list: List<'a, TypeNode<'a>>) {
        list.iter().for_each(|ty| self.visit(Node::Type(ty)));
    }

    fn visit(&mut self, node: Node<'a>) {
        match node {
            Node::Class(class) => {
                let id = class.id().0;
                self.scopes.push(ThisScope {
                    class: id,
                    this_context: id,
                    is_static_this_context: false,
                });
                self.visit_children(node);
                self.scopes.pop();
            }
            Node::Func(func) if func.has_body() && !func.is_arrow() => {
                self.scopes.push(self.scope_of_function(func));
                self.visit_children(node);
                self.scopes.pop();
            }
            Node::Member(member) => {
                self.visit_children(node);
                // Upstream leaves out only the keys of `MethodDefinition` and `PropertyDefinition`.
                if member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
                    && let Some(KeyKind::Private(name)) = member.key().map(Key::kind)
                {
                    self.private_identifier(name, None);
                }
            }
            Node::VarDecl(declarator) => {
                self.visit_children(node);
                self.binding(Some(declarator.pat()), declarator.init());
            }
            Node::Param(param) => {
                self.visit_children(node);
                self.binding(Some(param.pat()), param.default());
            }
            Node::PatProp(prop) => {
                self.visit_children(node);
                self.binding(Some(prop.value()), prop.default());
            }
            Node::PatElem(element) => {
                self.visit_children(node);
                self.binding(element.pat(), element.default());
            }
            Node::Type(ty) => match ty.kind() {
                // The name in a type query is no `MemberExpression`.
                TypeKind::Typeof { args, .. } => self.visit_all(args),
                _ => self.visit_children(node),
            },
            Node::Expr(e) => self.visit_expr(e),
            _ => self.visit_children(node),
        }
    }

    fn visit_expr(&mut self, e: Expr<'a>) {
        match e.kind() {
            ExprKind::Dot { obj, name, .. } => {
                self.visit(Node::Expr(obj));
                match name.bytes().starts_with(b"#") {
                    true => self.private_identifier(name.name(), Some(e)),
                    false => self.member_expression(e, obj),
                }
            }
            ExprKind::Index { obj, .. } => {
                self.visit_children(Node::Expr(e));
                self.member_expression(e, obj);
            }
            ExprKind::PrivateIdentifier(name) => self.private_identifier(name, e.parent().as_expr()),
            ExprKind::Assign { target, value, .. } => {
                self.visit_children(Node::Expr(e));
                if value.tag() == ExprTag::This
                    && let ExprKind::Object(props) = target.kind()
                {
                    let props = props.iter().filter(|it| it.kind() != PropKind::Spread);
                    self.this_destructuring(props.map(|it| it.key()));
                }
            }
            // The names of the tags are no `MemberExpression`s.
            ExprKind::Jsx(jsx) => {
                self.visit_all(jsx.type_args());
                jsx.attrs().iter().for_each(|it| self.visit(Node::Prop(it)));
                jsx.children().iter().for_each(|it| self.visit(Node::Expr(it)));
            }
            _ => self.visit_children(Node::Expr(e)),
        }
    }
}

/// typescript-eslint's `analyzeClassMemberUsage`.
///
/// Only the members that `is_tracked` holds for are in the result and are counted: a rule that
/// looks at private members passes `|member| member.is_private() || member.is_hash_private()`, and
/// a file without any costs one pass over its classes.
pub fn analyze_class_member_usage<'a>(
    file: &'a File<'a>,
    is_tracked: impl Fn(&ClassMember<'a>) -> bool,
) -> ClassMemberUsage<'a> {
    let mut usage = ClassMemberUsage::default();
    for id in 0..file.hir.classes.len() {
        usage.add_class(Class::new(file, hir::ClassId(id as u32)), &is_tracked);
    }
    if usage.members.is_empty() {
        return usage;
    }
    let mut analyzer = Analyzer {
        usage,
        scopes: Vec::new(),
    };
    for id in 0..file.hir.classes.len() {
        let class = Node::Class(Class::new(file, hir::ClassId(id as u32)));
        if !matches!(class.parent(), Node::File(_)) && class.enclosing_class().is_none() {
            analyzer.visit(class);
        }
    }
    analyzer.usage
}
