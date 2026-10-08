//! What a lint rule is.
//!
//! ```ignore
//! /// Disallow the use of `debugger`.
//! pub struct NoDebugger;
//!
//! const UNEXPECTED: Message = Message::new("unexpected", "Unexpected 'debugger' statement.");
//!
//! impl Rule for NoDebugger {
//!     const META: Meta = Meta::eslint("no-debugger", Kind::Problem).recommended();
//!     type State<'a> = ();
//!
//!     fn new(_: &Options) -> Self {
//!         NoDebugger
//!     }
//!
//!     fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
//!         on.stmts([StmtTag::Debugger], |_, stmt, cx| {
//!             cx.report(stmt, UNEXPECTED);
//!         });
//!     }
//! }
//! ```
//!
//! A rule is created once for each distinct set of options, and shared by all threads. For each
//! file it says what it listens for, and returns the state it keeps while that file is linted.
//!
//! How rules are run is designed around the HIR, which stores the nodes of a file in one vector
//! per sort:
//! - What a rule registers with [`Listeners::exprs`], [`Listeners::stmts`] and the like is called
//!   with every such node of the file, one listener after the other, each in a tight loop over the
//!   nodes of the kinds it asked for. There is no walk over the tree, and no work for a node that
//!   nobody listens for. The nodes come **in no particular order**.
//! - A rule that depends on the order, because it pushes on entering a function and pops on
//!   leaving it, registers with [`Listeners::enter`] and [`Listeners::exit`]. The file is walked
//!   once for all of these, and only if there are any. Most rules do not need it: from any node
//!   the way up is a few loads ([`Node::ancestors`](crate::ast::Node::ancestors)).
//! - [`Listeners::finish`] is called last.

use crate::ast::{
    BinOp, Case, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, ImportSpec, Member,
    Node, Param, Pat, PatTag, Prop, Stmt, StmtTag, TypeNode, TypeParam, TypeTag, UnOp, VarDecl,
};
use crate::code_path::{CodePath, Segment};
use crate::context::Cx;
use crate::literal::Literal;
use crate::options::Options;
use crate::semantic::Symbol;
use smallvec::SmallVec;

/// A message that a rule reports. `{{name}}` in `text` is replaced by what
/// [`Report::data`](crate::context::Report::data) provides.
#[derive(Copy, Clone, Debug)]
pub struct Message {
    /// ESLint's `messageId`.
    pub id: &'static str,
    pub text: &'static str,
    /// Whether there is a `{{` in `text`.
    pub(crate) may_have_placeholders: bool,
}

impl Message {
    pub const fn new(id: &'static str, text: &'static str) -> Message {
        let (bytes, mut at, mut may_have_placeholders) = (text.as_bytes(), 1, false);
        while at < bytes.len() {
            may_have_placeholders |= bytes[at - 1] == b'{' && bytes[at] == b'{';
            at += 1;
        }
        Message {
            id,
            text,
            may_have_placeholders,
        }
    }
}

/// Where a rule is from. It decides the prefix of its name in a configuration.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Plugin {
    /// `no-debugger`
    Eslint,
    /// `@typescript-eslint/no-explicit-any`
    TypeScript,
    /// `react-hooks/rules-of-hooks`
    ReactHooks,
    /// `import/no-cycle`
    Import,
    /// `n/no-unsupported-features/es-syntax`
    Node,
    /// `oxc/no-accumulating-spread`
    Oxc,
}

impl Plugin {
    /// What is before the `/` in the name that a rule is reported under. Empty for a rule of ESLint.
    pub const fn prefix(self) -> &'static str {
        match self {
            Plugin::Eslint => "",
            Plugin::TypeScript => "@typescript-eslint",
            Plugin::ReactHooks => "react-hooks",
            Plugin::Import => "import",
            Plugin::Node => "n",
            Plugin::Oxc => "oxc",
        }
    }

    /// The plugin that a configuration or a comment calls `prefix`: by the name that is usual with ESLint, or by one that oxlint
    /// has for it. oxlint has the rules of `react-hooks` in `react`.
    pub fn of_prefix(prefix: &[u8]) -> Option<Plugin> {
        Some(match prefix {
            b"" | b"eslint" => Plugin::Eslint,
            b"@typescript-eslint" | b"typescript-eslint" | b"typescript" => Plugin::TypeScript,
            b"react-hooks" | b"react_hooks" | b"react" => Plugin::ReactHooks,
            b"import" | b"import-x" => Plugin::Import,
            b"n" | b"node" => Plugin::Node,
            b"oxc" => Plugin::Oxc,
            _ => return None,
        })
    }
}

/// ESLint's `meta.type`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind {
    /// Code that is an error or may be confusing.
    Problem,
    /// Code that could be written in a better way.
    Suggestion,
    /// Whitespace, semicolons, commas, parentheses.
    Layout,
}

/// ESLint's `meta.fixable`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Fixable {
    No,
    Code,
    Whitespace,
}

bitflags::bitflags! {
    /// The configurations that ESLint and typescript-eslint publish, and that enable the rule.
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct Presets: u8 {
        /// `js.configs.recommended`, `tseslint.configs.recommended`
        const RECOMMENDED = 1 << 0;
        /// `tseslint.configs.recommendedTypeChecked`, and not `recommended`
        const RECOMMENDED_TYPE_CHECKED = 1 << 1;
        /// `tseslint.configs.strict`
        const STRICT = 1 << 2;
        const STRICT_TYPE_CHECKED = 1 << 3;
        /// `tseslint.configs.stylistic`
        const STYLISTIC = 1 << 4;
        const STYLISTIC_TYPE_CHECKED = 1 << 5;
    }
}

/// ESLint's `meta`.
#[derive(Copy, Clone, Debug)]
pub struct Meta {
    /// Without the prefix of the plugin.
    pub name: &'static str,
    pub plugin: Plugin,
    pub kind: Kind,
    pub fixable: Fixable,
    pub has_suggestions: bool,
    pub presets: Presets,
    /// It runs only on a file of a program that has been type checked, and
    /// [`File::types`](crate::ast::File::types) never fails in it.
    pub requires_types: bool,
    pub is_deprecated: bool,
    /// The rule of ESLint that this rule of typescript-eslint replaces.
    pub extends_base_rule: Option<&'static str>,
    /// It is about several files: see [`modules`](crate::modules).
    pub needs_modules: bool,
}

impl Meta {
    const fn new(plugin: Plugin, name: &'static str, kind: Kind) -> Meta {
        Meta {
            name,
            plugin,
            kind,
            fixable: Fixable::No,
            has_suggestions: false,
            presets: Presets::empty(),
            requires_types: false,
            is_deprecated: false,
            extends_base_rule: None,
            needs_modules: false,
        }
    }

    pub const fn eslint(name: &'static str, kind: Kind) -> Meta {
        Meta::new(Plugin::Eslint, name, kind)
    }

    pub const fn typescript(name: &'static str, kind: Kind) -> Meta {
        Meta::new(Plugin::TypeScript, name, kind)
    }

    /// A rule of another plugin.
    pub const fn plugin(plugin: Plugin, name: &'static str, kind: Kind) -> Meta {
        Meta::new(plugin, name, kind)
    }

    pub const fn fixable(mut self, fixable: Fixable) -> Meta {
        self.fixable = fixable;
        self
    }

    pub const fn has_suggestions(mut self) -> Meta {
        self.has_suggestions = true;
        self
    }

    pub const fn recommended(mut self) -> Meta {
        self.presets = self.presets.union(Presets::RECOMMENDED);
        self
    }

    pub const fn presets(mut self, presets: Presets) -> Meta {
        self.presets = self.presets.union(presets);
        self
    }

    pub const fn requires_types(mut self) -> Meta {
        self.requires_types = true;
        self
    }

    pub const fn needs_modules(mut self) -> Meta {
        self.needs_modules = true;
        self
    }

    pub const fn deprecated(mut self) -> Meta {
        self.is_deprecated = true;
        self
    }

    pub const fn extends_base_rule(mut self, name: &'static str) -> Meta {
        self.extends_base_rule = Some(name);
        self
    }
}

pub trait Rule: Send + Sync + Sized + 'static {
    const META: Meta;

    /// What the rule keeps while one file is linted: [`Cx::state`]. `()` if nothing.
    type State<'a>;

    /// `options`: what follows the severity in the configuration.
    fn new(options: &Options) -> Self;

    /// What is wrong with `options` that the schema of the rule cannot tell, where ESLint's rule throws: the message.
    fn validate(_options: &Options) -> Result<(), Vec<u8>> {
        Ok(())
    }

    /// Called for each file, like ESLint's `create`.
    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a>;
}

/// A function of the rule `R` that is called with an `N`.
pub type Listener<'a, R, N> = fn(&R, N, &mut Cx<'a, R>);

/// What a rule listens for in one file. What the file has no node for is not kept.
pub struct Listeners<'a, R: Rule> {
    pub(crate) entries: Entries<'a, R>,
    file: &'a File<'a>,
}

pub(crate) type Entries<'a, R> = SmallVec<[Entry<'a, R>; 4]>;

type OnCodePath<'a, R> = fn(&R, CodePath<'a>, Node<'a>, &mut Cx<'a, R>);
type OnSegment<'a, R> = fn(&R, Segment<'a>, Node<'a>, &mut Cx<'a, R>);
type OnSegmentLoop<'a, R> = fn(&R, Segment<'a>, Segment<'a>, Node<'a>, &mut Cx<'a, R>);

macro_rules! sorts {
    ($($(#[$doc:meta])* $method:ident $variant:ident $handle:ident $has_any:expr;)*) => {
        pub(crate) enum Entry<'a, R: Rule> {
            Exprs(ExprTag, Listener<'a, R, Expr<'a>>),
            Stmts(StmtTag, Listener<'a, R, Stmt<'a>>),
            Types(TypeTag, Listener<'a, R, TypeNode<'a>>),
            Pats(PatTag, Listener<'a, R, Pat<'a>>),
            Chained(ExprTag, Listener<'a, R, Expr<'a>>),
            Binaries(BinOp, Listener<'a, R, Expr<'a>>),
            Unaries(UnOp, Listener<'a, R, Expr<'a>>),
            $($variant(Listener<'a, R, $handle<'a>>),)*
            Nodes(NodeTags, Listener<'a, R, Node<'a>>),
            Enter(NodeTags, Listener<'a, R, Node<'a>>),
            Exit(NodeTags, Listener<'a, R, Node<'a>>),
            CodePathStart(OnCodePath<'a, R>),
            CodePathEnd(OnCodePath<'a, R>),
            SegmentStart(OnSegment<'a, R>),
            SegmentEnd(OnSegment<'a, R>),
            UnreachableSegmentStart(OnSegment<'a, R>),
            UnreachableSegmentEnd(OnSegment<'a, R>),
            SegmentLoop(OnSegmentLoop<'a, R>),
            Finish(fn(&R, &mut Cx<'a, R>)),
        }

        impl<R: Rule> Entry<'_, R> {
            /// Whether it is called in the order of the source or at the end.
            pub(crate) fn is_for_later(&self) -> bool {
                matches!(
                    self,
                    Entry::Enter(..)
                        | Entry::Exit(..)
                        | Entry::CodePathStart(_)
                        | Entry::CodePathEnd(_)
                        | Entry::SegmentStart(_)
                        | Entry::SegmentEnd(_)
                        | Entry::UnreachableSegmentStart(_)
                        | Entry::UnreachableSegmentEnd(_)
                        | Entry::SegmentLoop(_)
                        | Entry::Finish(_)
                )
            }
        }

        impl<'a, R: Rule> Listeners<'a, R> {
            $(
                $(#[$doc])*
                /// In no particular order.
                #[inline]
                pub fn $method(&mut self, listener: Listener<'a, R, $handle<'a>>) {
                    let has_any: fn(&File) -> bool = $has_any;
                    if has_any(self.file) {
                        self.entries.push(Entry::$variant(listener));
                    }
                }
            )*
        }
    };
}

sorts! {
    /// Every function-like: declarations, expressions, arrow functions, methods, accessors,
    /// constructors, static blocks, signatures, function types.
    funcs Funcs Func |file| !file.hir.fns.is_empty();
    /// Every class declaration and expression.
    classes Classes Class |file| !file.hir.classes.is_empty();
    /// Every member of a class, an interface or a type literal.
    members Members Member |file| !file.hir.members.is_empty();
    /// Every property of an object literal and every attribute of a JSX element.
    props Props Prop |file| !file.hir.props.is_empty();
    /// Every parameter.
    params Params Param |file| !file.hir.params.is_empty();
    /// Every type parameter.
    type_params TypeParams TypeParam |file| !file.hir.type_params.is_empty();
    /// Every `pat: ty = init` of a variable statement, and every `catch` parameter.
    var_decls VarDecls VarDecl |file| !file.hir.var_decls.is_empty();
    /// Every `case` and `default` clause.
    cases Cases Case |file| !file.hir.cases.is_empty();
    /// Every member of an enum.
    enum_members EnumMembers EnumMember |file| !file.hir.enum_members.is_empty();
    /// Every `a as b` in the braces of an import.
    import_specs ImportSpecs ImportSpec |file| !file.hir.import_specs.is_empty();
    /// Every `a as b` in the braces of an export.
    export_specs ExportSpecs ExportSpec |file| !file.hir.export_specs.is_empty();
    /// Everything that the file declares in a scope: variables, functions, classes, parameters,
    /// imports, types, namespaces, enums.
    symbols Symbols Symbol |_| true;
    /// Every string in quotes, which is a `Literal` for ESLint: not only the expressions, also the keys of properties and
    /// members, literal types, module specifiers, the names in quotes of imports and exports. Not the text in JSX.
    string_literals StringLiterals Literal |_| true;
    /// The same for numbers, including `1n`.
    number_literals NumberLiterals Literal |_| true;
}

impl<'a, R: Rule> Listeners<'a, R> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Listeners {
            entries: SmallVec::new(),
            file,
        }
    }

    /// Every expression of one of these kinds, in no particular order.
    pub fn exprs(
        &mut self,
        tags: impl IntoIterator<Item = ExprTag>,
        listener: Listener<'a, R, Expr<'a>>,
    ) {
        let tags = tags.into_iter().filter(|&tag| self.file.has_exprs([tag]));
        self.entries
            .extend(tags.map(|tag| Entry::Exprs(tag, listener)));
    }

    /// Every `Dot`, `Index` and `Call` that is part of an optional chain ([`Expr::chain`] is not `Chain::No`), in no particular
    /// order: in `a?.b.c()` that is `a?.b`, `a?.b.c` and `a?.b.c()`. Not the `!` in a chain.
    pub fn optional_chains(&mut self, listener: Listener<'a, R, Expr<'a>>) {
        let tags = [ExprTag::Dot, ExprTag::Index, ExprTag::Call].into_iter();
        let tags = tags.filter(|&tag| !self.file.chained_exprs_of(tag).is_empty());
        self.entries
            .extend(tags.map(|tag| Entry::Chained(tag, listener)));
    }

    /// Every [`ExprKind::Binary`](crate::ast::ExprKind::Binary) with one of these operators, in no particular order. A rule that
    /// is about `==` is not called with the other operators, and not at all in a file without a `==`.
    pub fn binaries(
        &mut self,
        ops: impl IntoIterator<Item = BinOp>,
        listener: Listener<'a, R, Expr<'a>>,
    ) {
        let ops = ops
            .into_iter()
            .filter(|&op| !self.file.binaries_of(op).is_empty());
        self.entries
            .extend(ops.map(|op| Entry::Binaries(op, listener)));
    }

    /// Every [`ExprKind::Unary`](crate::ast::ExprKind::Unary) with one of these operators, in no particular order.
    pub fn unaries(
        &mut self,
        ops: impl IntoIterator<Item = UnOp>,
        listener: Listener<'a, R, Expr<'a>>,
    ) {
        let ops = ops
            .into_iter()
            .filter(|&op| !self.file.unaries_of(op).is_empty());
        self.entries
            .extend(ops.map(|op| Entry::Unaries(op, listener)));
    }

    /// Every statement of one of these kinds, in no particular order.
    pub fn stmts(
        &mut self,
        tags: impl IntoIterator<Item = StmtTag>,
        listener: Listener<'a, R, Stmt<'a>>,
    ) {
        let tags = tags.into_iter().filter(|&tag| self.file.has_stmts([tag]));
        self.entries
            .extend(tags.map(|tag| Entry::Stmts(tag, listener)));
    }

    /// Every type of one of these kinds, in no particular order.
    pub fn types(
        &mut self,
        tags: impl IntoIterator<Item = TypeTag>,
        listener: Listener<'a, R, TypeNode<'a>>,
    ) {
        let tags = tags
            .into_iter()
            .filter(|&tag| !self.file.types_of(tag).is_empty());
        self.entries
            .extend(tags.map(|tag| Entry::Types(tag, listener)));
    }

    /// Every binding pattern of one of these kinds, in no particular order.
    pub fn pats(
        &mut self,
        tags: impl IntoIterator<Item = PatTag>,
        listener: Listener<'a, R, Pat<'a>>,
    ) {
        let tags = tags
            .into_iter()
            .filter(|&tag| !self.file.pats_of(tag).is_empty());
        self.entries
            .extend(tags.map(|tag| Entry::Pats(tag, listener)));
    }

    /// Every node of one of these kinds, in no particular order: for a rule that learns from its options which kinds it is about.
    pub fn nodes(&mut self, tags: impl Into<NodeTags>, listener: Listener<'a, R, Node<'a>>) {
        self.entries.push(Entry::Nodes(tags.into(), listener));
    }

    /// Every node of one of these kinds, in source order, before its children.
    ///
    /// This makes the linter walk the file, which the listeners above do not need.
    pub fn enter(&mut self, tags: impl Into<NodeTags>, listener: Listener<'a, R, Node<'a>>) {
        self.entries.push(Entry::Enter(tags.into(), listener));
    }

    /// Every node of one of these kinds, in source order, after its children.
    pub fn exit(&mut self, tags: impl Into<NodeTags>, listener: Listener<'a, R, Node<'a>>) {
        self.entries.push(Entry::Exit(tags.into(), listener));
    }

    /// Once, after everything else.
    pub fn finish(&mut self, listener: fn(&R, &mut Cx<'a, R>)) {
        self.entries.push(Entry::Finish(listener));
    }

    /// ESLint's `onCodePathStart`. Like all of the following, it is called during the walk, in
    /// order with [`Listeners::enter`] and [`Listeners::exit`].
    pub fn code_path_start(&mut self, listener: OnCodePath<'a, R>) {
        self.entries.push(Entry::CodePathStart(listener));
    }

    /// ESLint's `onCodePathEnd`.
    pub fn code_path_end(&mut self, listener: OnCodePath<'a, R>) {
        self.entries.push(Entry::CodePathEnd(listener));
    }

    /// ESLint's `onCodePathSegmentStart`.
    pub fn segment_start(&mut self, listener: OnSegment<'a, R>) {
        self.entries.push(Entry::SegmentStart(listener));
    }

    /// ESLint's `onCodePathSegmentEnd`.
    pub fn segment_end(&mut self, listener: OnSegment<'a, R>) {
        self.entries.push(Entry::SegmentEnd(listener));
    }

    /// ESLint's `onUnreachableCodePathSegmentStart`.
    pub fn unreachable_segment_start(&mut self, listener: OnSegment<'a, R>) {
        self.entries.push(Entry::UnreachableSegmentStart(listener));
    }

    /// ESLint's `onUnreachableCodePathSegmentEnd`.
    pub fn unreachable_segment_end(&mut self, listener: OnSegment<'a, R>) {
        self.entries.push(Entry::UnreachableSegmentEnd(listener));
    }

    /// ESLint's `onCodePathSegmentLoop`: from the first segment to the second.
    pub fn segment_loop(&mut self, listener: OnSegmentLoop<'a, R>) {
        self.entries.push(Entry::SegmentLoop(listener));
    }
}

/// A set of kinds of nodes, for [`Listeners::enter`] and [`Listeners::exit`].
///
/// An [`ExprTag`], a [`StmtTag`], a [`TypeTag`] or an array of them converts to one, and `|`
/// combines them: `NodeTags::FUNC | StmtTag::Block.into()`.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct NodeTags(u128);

const STMTS: u32 = ExprTag::COUNT as u32;
const TYPES: u32 = STMTS + StmtTag::COUNT as u32;
const REST: u32 = TYPES + TypeTag::COUNT as u32;

impl NodeTags {
    pub const EMPTY: NodeTags = NodeTags(0);
    pub const FILE: NodeTags = NodeTags(1 << REST);
    pub const FUNC: NodeTags = NodeTags(1 << (REST + 1));
    pub const CLASS: NodeTags = NodeTags(1 << (REST + 2));
    pub const MEMBER: NodeTags = NodeTags(1 << (REST + 3));
    pub const PROP: NodeTags = NodeTags(1 << (REST + 4));
    pub const PARAM: NodeTags = NodeTags(1 << (REST + 5));
    pub const TYPE_PARAM: NodeTags = NodeTags(1 << (REST + 6));
    pub const VAR_DECL: NodeTags = NodeTags(1 << (REST + 7));
    pub const CASE: NodeTags = NodeTags(1 << (REST + 8));
    pub const ENUM_MEMBER: NodeTags = NodeTags(1 << (REST + 9));
    pub const IMPORT_SPEC: NodeTags = NodeTags(1 << (REST + 10));
    pub const EXPORT_SPEC: NodeTags = NodeTags(1 << (REST + 11));
    pub const TUPLE_ELEM: NodeTags = NodeTags(1 << (REST + 12));
    pub const PAT: NodeTags = NodeTags(1 << (REST + 13));
    pub const PAT_PROP: NodeTags = NodeTags(1 << (REST + 14));
    pub const PAT_ELEM: NodeTags = NodeTags(1 << (REST + 15));
    pub const ALL: NodeTags = NodeTags(u128::MAX);

    pub(crate) const COUNT: usize = REST as usize + 16;

    #[inline]
    pub const fn union(self, other: NodeTags) -> NodeTags {
        NodeTags(self.0 | other.0)
    }

    #[inline]
    pub const fn intersects(self, other: NodeTags) -> bool {
        self.0 & other.0 != 0
    }

    #[inline]
    pub(crate) const fn has_index(self, index: u32) -> bool {
        self.0 & (1 << index) != 0
    }

    /// The numbers of the bits that are set: see [`NodeTags::index_of`].
    #[inline]
    pub(crate) fn indices(self) -> impl Iterator<Item = u32> {
        let mut rest = self.0 & ((1 << NodeTags::COUNT) - 1);
        std::iter::from_fn(move || {
            (rest != 0).then(|| {
                let index = rest.trailing_zeros();
                rest &= rest - 1;
                index
            })
        })
    }

    #[inline]
    pub fn contains(self, node: Node) -> bool {
        self.has_index(NodeTags::index_of(node))
    }

    /// The number of the bit for the kind of `node`.
    #[inline]
    pub(crate) fn index_of(node: Node) -> u32 {
        match node {
            Node::Expr(e) => e.tag() as u32,
            Node::Stmt(s) => STMTS + s.tag() as u32,
            Node::Type(t) => TYPES + t.tag() as u32,
            Node::File(_) => REST,
            Node::Func(_) => REST + 1,
            Node::Class(_) => REST + 2,
            Node::Member(_) => REST + 3,
            Node::Prop(_) => REST + 4,
            Node::Param(_) => REST + 5,
            Node::TypeParam(_) => REST + 6,
            Node::VarDecl(_) => REST + 7,
            Node::Case(_) => REST + 8,
            Node::EnumMember(_) => REST + 9,
            Node::ImportSpec(_) => REST + 10,
            Node::ExportSpec(_) => REST + 11,
            Node::TupleElem(_) => REST + 12,
            Node::Pat(_) => REST + 13,
            Node::PatProp(_) => REST + 14,
            Node::PatElem(_) => REST + 15,
        }
    }
}

const _: () = assert!(NodeTags::COUNT < 128);

impl std::ops::BitOr for NodeTags {
    type Output = NodeTags;
    #[inline]
    fn bitor(self, other: NodeTags) -> NodeTags {
        self.union(other)
    }
}

impl From<ExprTag> for NodeTags {
    #[inline]
    fn from(tag: ExprTag) -> NodeTags {
        NodeTags(1 << tag as u32)
    }
}
impl From<StmtTag> for NodeTags {
    #[inline]
    fn from(tag: StmtTag) -> NodeTags {
        NodeTags(1 << (STMTS + tag as u32))
    }
}
impl From<TypeTag> for NodeTags {
    #[inline]
    fn from(tag: TypeTag) -> NodeTags {
        NodeTags(1 << (TYPES + tag as u32))
    }
}
impl<T: Into<NodeTags>, const N: usize> From<[T; N]> for NodeTags {
    fn from(tags: [T; N]) -> NodeTags {
        tags.into_iter()
            .fold(NodeTags::EMPTY, |all, tag| all | tag.into())
    }
}
