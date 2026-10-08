//! typescript-eslint's `util/class-scope-analyzer/`: how often the members of each class are read
//! and written from inside the class.
//!
//! The members of all classes are one vector, in which each class has a range. Nothing is walked:
//! the member accesses of the file are gone through, and only for one whose name is that of a
//! tracked member is it looked up, by its position, which classes and functions it is in.

use super::estree::is_expression_statement;
use super::{Variable, is_variable_declarator_definition};
use crate::ast::{
    Class, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Key, KeyKind, Member, MemberKind,
    Name, Node, Param, Pat, PatElem, PatKind, PatProp, PropKind, TypeKind, TypeNode, UnOp, VarDecl,
};
use crate::semantic::Declaration;
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use crate::utils::estree_compat::{estree_span, is_assignment_target};
use crate::utils::text::number_to_string;
use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
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
        }
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
            let span = key.inner_span(file);
            // Upstream takes the raw text of a template.
            match file.slice(span).starts_with(b"`") {
                true => (file.slice(span.shrink(1, 1)), span),
                false => (name.bytes(), span),
            }
        }
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::Private(name) => (name.bytes(), whole),
    };
    Some(ExtractedName {
        code_name: Cow::Borrowed(name),
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
            let start = skip_trivia(
                text,
                member.modifiers().last().map_or(start, |it| it.span().end),
            );
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
    /// For each of `members`.
    keys: Vec<MemberKey>,
}

/// Upstream's `Key`, and which of the two maps of the class it is a key of.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct MemberKey {
    name: Atom,
    is_private: bool,
    is_static: bool,
}

/// The name of a member that is written as an identifier, a string, a number or a private name
/// without brackets, and whether it is a private name.
fn plain_name<'a>(node: MemberNode<'a>) -> Option<(Name<'a>, bool)> {
    match node {
        MemberNode::Member(member) => match member.key()?.kind() {
            KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::Number(name) => {
                Some((name, false))
            }
            KeyKind::Private(name) => Some((name, true)),
            _ => None,
        },
        MemberNode::ParameterProperty(param) => Some((param.pat().as_ident()?, false)),
    }
}

/// A member of the class that is being added.
struct Candidate<'a> {
    key: MemberKey,
    node: MemberNode<'a>,
    /// Unless it has a [`plain_name`].
    name: Option<ExtractedName<'a>>,
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
        self.members
            .get(first..first + class.member_count as usize)
            .unwrap_or_default()
    }

    /// The members of all the classes.
    #[inline]
    pub fn members(&self) -> &[ClassMember<'a>] {
        &self.members
    }

    /// `members.static.get(key)` or `members.instance.get(key)`, as an index.
    fn find(&self, class: u32, key: MemberKey) -> Option<usize> {
        let class = self.classes.get(class as usize)?;
        let first = class.first_member as usize;
        let keys = self.keys.get(first..first + class.member_count as usize)?;
        Some(first + keys.iter().position(|it| *it == key)?)
    }

    /// What the constructor of upstream's `ClassScope` does. `candidates` is scratch space.
    fn add_class(
        &mut self,
        class: Class<'a>,
        is_tracked: &impl Fn(&ClassMember<'a>) -> bool,
        candidates: &mut Vec<Candidate<'a>>,
    ) {
        let file = class.file();
        candidates.clear();
        let mut add = |node: MemberNode<'a>, flags: Flags| {
            let (name, is_private, extracted) = match plain_name(node) {
                Some((name, is_private)) => (name.atom(), is_private, None),
                None => match extract_name_for_member(node) {
                    Some(name) => (file.atoms.intern(&name.code_name), false, Some(name)),
                    None => return,
                },
            };
            let candidate = Candidate {
                key: MemberKey {
                    name,
                    is_private,
                    is_static: flags.contains(Flags::STATIC),
                },
                node,
                name: extracted,
            };
            // As in a `Map`, the last with a key takes the place of the first.
            match candidates.iter_mut().find(|it| it.key == candidate.key) {
                Some(same) => *same = candidate,
                None => candidates.push(candidate),
            }
        };
        for member in class.members() {
            match member.kind() {
                MemberKind::Constructor if !member.is_static() => {
                    let params = member.func().map(Func::params).into_iter().flatten();
                    params
                        .filter(|param| param.is_parameter_property())
                        .for_each(|param| add(MemberNode::ParameterProperty(param), param.flags()));
                }
                MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => add(MemberNode::Member(member), member.flags()),
                _ => {}
            }
        }
        let first = self.members.len();
        for candidate in candidates.drain(..) {
            let is_plain = candidate.name.is_none();
            let mut member = ClassMember {
                node: candidate.node,
                name: candidate.name.unwrap_or_else(|| ExtractedName {
                    code_name: Cow::Borrowed(file.name(candidate.key.name).bytes()),
                    is_private: candidate.key.is_private,
                    name_span: Span::default(),
                }),
                write_count: 0,
                read_count: 0,
            };
            if !is_tracked(&member) {
                continue;
            }
            if is_plain {
                member.name.name_span = match candidate.node {
                    MemberNode::Member(it) => it.key().map_or_else(Span::default, |key| key.span(file)),
                    MemberNode::ParameterProperty(it) => estree_span(Node::Pat(it.pat())),
                };
            }
            self.members.push(member);
            self.keys.push(candidate.key);
        }
        self.classes.push(ClassScopeResult {
            class,
            class_name: class.name().map(|name| name.name()),
            first_member: first as u32,
            member_count: (self.members.len() - first) as u32,
        });
    }
}

// ───────────────────────────── references ─────────────────────────────

/// What upstream's `countReference` counts as a write: `node`, the access to the member, is only
/// assigned to. `a.b += 1` and `a.b++` are writes if nothing takes their value.
fn is_write_only_usage(node: Expr) -> bool {
    let is_statement =
        |e: Expr| matches!(e.parent(), Node::Stmt(it) if is_expression_statement(it));
    match node
        .parent()
        .as_expr()
        .map(|parent| (parent, parent.kind()))
    {
        Some((
            parent,
            ExprKind::Assign {
                op: Some(_),
                target,
                ..
            },
        )) if target == node => is_statement(parent),
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
    /// What is written from `start` to `end` is in it.
    start: u32,
    end: u32,
    /// The index of the scope around it.
    upper: u32,
    /// The class, for a `ClassScope`.
    class: u32,
    /// `thisContext`: the class whose instance or constructor `this` is.
    this_context: u32,
    is_static_this_context: bool,
}

/// The names of the tracked members.
struct Names {
    /// A bit for the low bits of each.
    bits: [u64; 16],
    sorted: Vec<Atom>,
    /// One is what a literal that is not a string can stand for: `0`, `true`, `/a/`.
    has_literal: bool,
    has_public: bool,
}

impl Names {
    fn new(usage: &ClassMemberUsage) -> Names {
        let mut sorted: Vec<Atom> = usage.keys.iter().map(|key| key.name).collect();
        sorted.sort_unstable_by_key(|name| name.0);
        sorted.dedup();
        let mut bits = [0; 16];
        for name in &sorted {
            bits[(name.0 as usize >> 6) & 15] |= 1 << (name.0 & 63);
        }
        let is_literal = |name: &[u8]| {
            matches!(name, b"true" | b"false" | b"null" | b"Infinity")
                || !name.first().is_some_and(|&c| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$' | b'#' | 0x80..))
        };
        Names {
            bits,
            sorted,
            has_literal: usage.members.iter().any(|it| is_literal(&it.name.code_name)),
            has_public: usage.keys.iter().any(|key| !key.is_private),
        }
    }

    #[inline]
    fn contains(&self, name: Atom) -> bool {
        self.bits[(name.0 as usize >> 6) & 15] & (1 << (name.0 & 63)) != 0
            && self.sorted.binary_search_by_key(&name.0, |it| it.0).is_ok()
    }
}

struct Analyzer<'a> {
    file: &'a File<'a>,
    usage: ClassMemberUsage<'a>,
    /// Sorted by `start`, so that a scope comes before those in it. Empty until it is needed.
    scopes: Vec<ThisScope>,
}

impl<'a> Analyzer<'a> {
    fn scope(&self, scope: u32) -> Option<&ThisScope> {
        self.scopes.get(scope as usize)
    }

    /// `scope`, its `upper`, and so on.
    fn chain(&self, scope: u32) -> impl Iterator<Item = &ThisScope> {
        std::iter::successors(self.scope(scope), |it| self.scope(it.upper))
    }

    /// The classes of the file, and the functions in them that are not arrow functions.
    fn find_scopes(&mut self) {
        let file = self.file;
        let mut all: Vec<(Span, Result<Class<'a>, Func<'a>>)> = Vec::new();
        all.extend(file.classes().map(|class| (class.span(), Ok(class))));
        let classes = all.iter().fold(Span::new(u32::MAX, 0), |all, it| {
            Span::new(all.start.min(it.0.start), all.end.max(it.0.end))
        });
        for func in file.funcs().filter(|it| it.has_body() && !it.is_arrow()) {
            // The name and the decorators of a method are not in it.
            let span = match func.kind() {
                FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                    func.span_from_params()
                }
                _ => func.span(),
            };
            if classes.contains(span) {
                all.push((span, Err(func)));
            }
        }
        all.sort_unstable_by_key(|it| (it.0.start, std::cmp::Reverse(it.0.end)));
        self.scopes.reserve(all.len());
        let mut upper = NONE;
        for (span, what) in all {
            while self.scope(upper).is_some_and(|it| it.end <= span.start) {
                upper = self.scope(upper).map_or(NONE, |it| it.upper);
            }
            let (class, this_context, is_static_this_context) = match what {
                Ok(class) => (class.id().0, class.id().0, false),
                Err(_) if upper == NONE => continue,
                Err(func) => {
                    let (this_context, is_static) = self.this_of_function(func, upper);
                    (NONE, this_context, is_static)
                }
            };
            self.scopes.push(ThisScope {
                start: span.start,
                end: span.end,
                upper,
                class,
                this_context,
                is_static_this_context,
            });
            upper = self.scopes.len() as u32 - 1;
        }
    }

    /// The innermost scope that what is written at `at` is in.
    fn scope_at(&mut self, at: u32) -> u32 {
        if self.scopes.is_empty() {
            self.find_scopes();
        }
        let before = self.scopes.partition_point(|it| it.start <= at);
        let mut scope = before.checked_sub(1).map_or(NONE, |it| it as u32);
        while let Some(it) = self.scope(scope)
            && it.end <= at
        {
            scope = it.upper;
        }
        scope
    }

    fn find_class_scope_with_name(&self, from: u32, name: Name<'a>) -> Option<u32> {
        let classes = self.chain(from).map(|scope| scope.class);
        classes.filter(|&class| class != NONE).find(|&class| {
            self.usage
                .classes
                .get(class as usize)
                .is_some_and(|it| it.class_name == Some(name))
        })
    }

    /// The class that `this` belongs to in `scope`, and whether it is the class itself.
    fn this_class(&self, scope: u32) -> Option<(u32, bool)> {
        let scope = self.scope(scope).filter(|it| it.this_context != NONE)?;
        Some((scope.this_context, scope.is_static_this_context))
    }

    /// The class that an annotation `Foo` or `typeof Foo` names, and whether it is the class
    /// itself.
    fn class_of_annotation(&self, scope: u32, ty: TypeNode<'a>) -> Option<(u32, bool)> {
        match ty.kind() {
            TypeKind::Ref { name, .. } => Some((
                self.find_class_scope_with_name(scope, name.as_ident()?.name())?,
                false,
            )),
            TypeKind::Typeof { expr, .. } => Some((
                self.find_class_scope_with_name(scope, expr.as_ident()?)?,
                true,
            )),
            _ => None,
        }
    }

    /// Upstream's `getObjectClass`, of the object of a member access in `scope`.
    fn get_object_class(&self, scope: u32, object: Expr<'a>) -> Option<(u32, bool)> {
        let name = match object.kind() {
            ExprKind::This => return self.this_class(scope),
            ExprKind::Ident(name) => name,
            _ => return None,
        };
        if let Some(class) = self.find_class_scope_with_name(scope, name) {
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
                self.this_class(scope)
            }
            Declaration::Var(pat) => match pat.parent() {
                Node::VarDecl(declarator) => self.class_of_annotation(scope, declarator.ty()?),
                _ => None,
            },
            // `method(thing: Foo)`
            Declaration::Param(pat) => match pat.parent() {
                Node::Param(param) if !param.is_rest() => {
                    self.class_of_annotation(scope, param.ty()?)
                }
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

    /// `object.name`, `object["name"]`. `at` is in `node` and in nothing that is in it.
    fn member_expression(&mut self, node: Expr<'a>, object: Expr<'a>, name: Atom, at: u32) {
        let scope = self.scope_at(at);
        if let Some((class, is_static)) = self.get_object_class(scope, object)
            && let Some(member) = self.usage.find(
                class,
                MemberKey {
                    name,
                    is_private: false,
                    is_static,
                },
            )
        {
            self.count_reference(member, is_write_only_usage(node));
        }
    }

    /// `#name` at `at`, in `parent` if that is an expression.
    fn private_identifier(&mut self, name: Atom, at: u32, parent: Option<Expr<'a>>) {
        let scope = self.scope_at(at);
        let contexts = self.chain(scope).map(|scope| scope.this_context);
        let member = contexts.filter(|&class| class != NONE).find_map(|class| {
            let find = |is_static| {
                self.usage.find(
                    class,
                    MemberKey {
                        name,
                        is_private: true,
                        is_static,
                    },
                )
            };
            find(false).or_else(|| find(true))
        });
        if let Some(member) = member {
            self.count_reference(member, parent.is_some_and(is_write_only_usage));
        }
    }

    /// Upstream's `handleThisDestructuring`: `{ name } = this`, with the `this` at `at`, reads the
    /// member.
    fn this_destructuring(&mut self, at: u32, keys: impl Iterator<Item = Option<Key<'a>>>) {
        let scope = self.scope_at(at);
        let Some((class, is_static)) = self.this_class(scope) else {
            return;
        };
        for key in keys.flatten() {
            if let KeyKind::Ident(name) = key.kind()
                && let Some(member) = self.usage.find(
                    class,
                    MemberKey {
                        name: name.atom(),
                        is_private: false,
                        is_static,
                    },
                )
            {
                self.count_reference(member, false);
            }
        }
    }

    /// `thisContext` and `isStaticThisContext` of upstream's `IntermediateScope`, for a function
    /// with a body or a static block that is directly in the scope `upper`.
    fn this_of_function(&self, func: Func<'a>, upper: u32) -> (u32, bool) {
        let class = self.scope(upper).map_or(NONE, |scope| scope.class);
        if func.kind() == FnKind::StaticBlock {
            return (class, true);
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
            return (class, member.is_static());
        }
        let this_type = func.this_param().and_then(Param::ty).map(TypeNode::kind);
        if let Some(TypeKind::Ref { name, .. }) = this_type
            && let Some(name) = name.as_ident()
            && let Some(class) = self.find_class_scope_with_name(upper, name.name())
        {
            return (class, false);
        }
        (NONE, false)
    }

    /// The `this` of `pattern = this`, if `this` is that.
    fn this_expression(&mut self, this: Expr<'a>) {
        let file = self.file;
        let pat = match file.bound.expr_parent.get(this.id().idx()) {
            Some(&Parent::VarInit(it)) => Some(VarDecl::new(file, it).pat()),
            Some(&Parent::ParamDefault(it)) => Some(Param::new(file, it).pat()),
            Some(&Parent::PatPropDefault(it)) => Some(PatProp::new(file, it).value()),
            Some(&Parent::PatElemDefault(it)) => PatElem::new(file, it).pat(),
            Some(&Parent::Expr(parent)) => {
                if let ExprKind::Assign { target, value, .. } = Expr::new(file, parent).kind()
                    && value == this
                    && let ExprKind::Object(props) = target.kind()
                {
                    let props = props.iter().filter(|it| it.kind() != PropKind::Spread);
                    self.this_destructuring(this.span().start, props.map(|it| it.key()));
                }
                None
            }
            _ => None,
        };
        if let Some(PatKind::Object(props)) = pat.map(Pat::kind) {
            let props = props.iter().filter(|it| !it.is_rest());
            self.this_destructuring(this.span().start, props.map(|it| it.key()));
        }
    }

    /// The key of the tracked members that are called `name`.
    fn name_of_literal(&self, name: &[u8]) -> Option<Atom> {
        let at = (self.usage.members.iter()).position(|it| *it.name.code_name == *name)?;
        Some(self.usage.keys.get(at)?.name)
    }
}

/// Whether `e` is the name after `typeof` in a type, or the start of it: no `MemberExpression`.
fn is_in_type_query(mut e: Expr) -> bool {
    let operands = e.file().bound.type_query_operands;
    if operands.is_empty() {
        return false;
    }
    loop {
        if operands.binary_search(&e.id()).is_ok() {
            return true;
        }
        match e.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == e) => {
                e = parent;
            }
            _ => return false,
        }
    }
}

/// typescript-eslint's `analyzeClassMemberUsage`.
///
/// Only the members that `is_tracked` holds for are in the result and are counted: a rule that
/// looks at private members passes `|member| member.is_private() || member.is_hash_private()`, and
/// a file without any costs one pass over its classes. `is_tracked` is asked before
/// `name.name_span` is known.
pub fn analyze_class_member_usage<'a>(
    file: &'a File<'a>,
    is_tracked: impl Fn(&ClassMember<'a>) -> bool,
) -> ClassMemberUsage<'a> {
    let mut usage = ClassMemberUsage::default();
    let mut candidates = Vec::new();
    for id in 0..file.hir.classes.len() {
        usage.add_class(Class::new(file, hir::ClassId(id as u32)), &is_tracked, &mut candidates);
    }
    if usage.members.is_empty() {
        return usage;
    }
    let names = Names::new(&usage);
    let mut analyzer = Analyzer {
        file,
        usage,
        scopes: Vec::new(),
    };
    let tag_of = |e: hir::ExprId| file.hir.exprs.get(e.idx()).map(|it| it.kind.tag());
    for e in file.exprs_of_kind(ExprTag::Dot) {
        let Some(hir::ExprKind::Dot { obj, name, name_pos, .. }) = e.try_raw().map(|it| it.kind) else {
            continue;
        };
        if !names.contains(name) {
            continue;
        }
        let is_private = file.name(name).bytes().starts_with(b"#");
        if !is_private && !matches!(tag_of(obj), Some(ExprTag::This | ExprTag::Ident)) {
            continue;
        }
        // The names of the tags of JSX are no `MemberExpression`s either.
        if e.is_jsx_tag_name() || is_in_type_query(e) {
            continue;
        }
        match is_private {
            true => analyzer.private_identifier(name, name_pos, Some(e)),
            false => analyzer.member_expression(e, Expr::new(file, obj), name, name_pos),
        }
    }
    for e in file.exprs_of_kind(ExprTag::PrivateIdentifier) {
        if let ExprKind::PrivateIdentifier(name) = e.kind()
            && names.contains(name.atom())
        {
            analyzer.private_identifier(name.atom(), e.span().start, e.parent().as_expr());
        }
    }
    // Upstream leaves out only the keys of `MethodDefinition` and `PropertyDefinition`.
    for class in file.classes() {
        for member in class.members() {
            if member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
                && let Some(key) = member.key()
                && let KeyKind::Private(name) = key.kind()
            {
                analyzer.private_identifier(name.atom(), key.span(file).start, None);
            }
        }
    }
    if !names.has_public {
        return analyzer.usage;
    }
    for e in file.exprs_of_kind(ExprTag::Index) {
        let Some(hir::ExprKind::Index { obj, index, .. }) = e.try_raw().map(|it| it.kind) else {
            continue;
        };
        if !matches!(tag_of(obj), Some(ExprTag::This | ExprTag::Ident)) {
            continue;
        }
        let index = Expr::new(file, index);
        let name = match index.kind() {
            ExprKind::String(name) => Some(name.atom()).filter(|it| names.contains(*it)),
            ExprKind::Template(_) => extract_computed_name(index)
                .and_then(|it| analyzer.name_of_literal(&it.code_name)),
            _ if names.has_literal => extract_computed_name(index)
                .and_then(|it| analyzer.name_of_literal(&it.code_name)),
            _ => None,
        };
        if let Some(name) = name {
            let at = e.span().end.saturating_sub(1);
            analyzer.member_expression(e, Expr::new(file, obj), name, at);
        }
    }
    for e in file.exprs_of_kind(ExprTag::This) {
        analyzer.this_expression(e);
    }
    analyzer.usage
}
