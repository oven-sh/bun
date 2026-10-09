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
use crate::runner;
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

/// Who answers for the rules of a plugin in a configuration of ESLint.
#[derive(Copy, Clone, PartialEq, Eq)]
enum UnderEslint {
    /// The rules here. There is no package that could.
    Here,
    /// The rules here, in place of those of the package of that name, which is loaded for the rules that do not exist
    /// here. Without a name: whatever the plugin of the configuration says it is called. And the version of the package that
    /// the rules here do the same as.
    InPlaceOf(Option<&'static str>, &'static str),
    /// The package of the project, which has other messages and other options: the rules here are those of oxlint,
    /// for a configuration of oxlint.
    Package,
}

/// What a plugin is called, and who answers for it.
struct Names {
    /// What can be before the `/`. The first is in the name that a rule is reported under, which is the name that is
    /// usual with ESLint. The others are what oxlint calls the plugin.
    prefixes: &'static [&'static str],
    under_eslint: UnderEslint,
}

macro_rules! plugins {
    ($($(#[$example:meta])* $plugin:ident: $prefixes:expr, $under_eslint:expr;)*) => {
        /// Where a rule is from. It decides the prefix of its name in a configuration.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        pub enum Plugin {
            $($(#[$example])* $plugin,)*
        }

        impl Plugin {
            const ALL: &'static [Plugin] = &[$(Plugin::$plugin),*];

            const fn names(self) -> Names {
                use UnderEslint::{Here, InPlaceOf, Package};
                match self {
                    $(Plugin::$plugin => Names { prefixes: &$prefixes, under_eslint: $under_eslint },)*
                }
            }
        }
    };
}

// The one place that says what a plugin is called and who answers for it: what finds a rule by its name, what reads the
// `plugins` of a configuration and what decides whether a package is loaded all ask here. oxlint has the rules of
// `react-hooks` in `react`. Two lists answer other questions: the order in which oxlint looks for a name without a
// prefix (`PLUGINS_OF_OXLINT`), and that in which its rules report at one node (`order_fixes_as_oxlint`).
plugins! {
    /// `no-debugger`
    Eslint: ["", "eslint"], Here;
    /// `@typescript-eslint/no-explicit-any`
    TypeScript: ["@typescript-eslint", "typescript-eslint", "typescript"], InPlaceOf(None, "8.71.1");
    /// `react-hooks/rules-of-hooks`
    ReactHooks: ["react-hooks", "react_hooks", "react"], InPlaceOf(Some("eslint-plugin-react-hooks"), "7.1.1");
    /// `import/no-cycle`
    Import: ["import", "import-x"], InPlaceOf(Some("eslint-plugin-import"), "2.32.0");
    /// `n/no-unsupported-features/es-syntax`
    Node: ["n", "node"], InPlaceOf(Some("eslint-plugin-n"), "18.4.1");
    /// `oxc/no-accumulating-spread`
    Oxc: ["oxc"], Here;
    /// `unicorn/no-null`
    Unicorn: ["unicorn"], Package;
    /// `react/jsx-key`
    React: ["react", "react-hooks", "react_hooks"], Package;
    /// `react-perf/jsx-no-new-object-as-prop`
    ReactPerf: ["react-perf", "react_perf"], Package;
    /// `jsx-a11y/alt-text`
    JsxA11y: ["jsx-a11y", "jsx_a11y"], Package;
    /// `@next/next/no-img-element`
    Nextjs: ["@next/next", "nextjs"], Package;
    /// `promise/param-names`
    Promise: ["promise"], Package;
    /// `jest/no-focused-tests`
    Jest: ["jest"], Package;
    /// `vitest/no-focused-tests`
    Vitest: ["vitest"], Package;
    /// `jsdoc/require-param`
    Jsdoc: ["jsdoc"], Package;
    /// `vue/no-dupe-keys`
    Vue: ["vue"], Package;
}

impl Plugin {
    /// What is before the `/` in the name that a rule is reported under. Empty for a rule of ESLint.
    pub const fn prefix(self) -> &'static str {
        match self.names().prefixes.first() {
            Some(prefix) => *prefix,
            None => "",
        }
    }

    fn is_called(self, prefix: &[u8]) -> bool {
        self.names()
            .prefixes
            .iter()
            .any(|it| it.as_bytes() == prefix)
    }

    fn is_only_of_oxlint(self) -> bool {
        self.names().under_eslint == UnderEslint::Package
    }

    /// The plugin that a configuration or a comment calls `prefix`: by the name that is usual with ESLint, or by one
    /// that oxlint has for it.
    pub fn of_prefix(prefix: &[u8]) -> Option<Plugin> {
        let mut all = Plugin::ALL.iter().copied();
        all.find(|it| !it.is_only_of_oxlint() && it.is_called(prefix))
    }

    /// The same in a configuration of oxlint and in the comments of a file that is linted with one. oxlint has more
    /// plugins built in. With ESLint these are packages of the project.
    pub fn of_oxlint_prefix(prefix: &[u8]) -> Option<Plugin> {
        let mut all = Plugin::ALL.iter().copied();
        all.find(|it| it.is_only_of_oxlint() && it.is_called(prefix))
            .or_else(|| Plugin::of_prefix(prefix))
    }

    /// Whether the rules here answer for the plugin that a configuration of ESLint has as `prefix`, in place of those
    /// of the package: it has the name that is usual for it, and it is that package. `package`: what the plugin says it
    /// is called, if it says so.
    pub(crate) fn answers_in_place_of(prefix: &[u8], package: Option<&[u8]>) -> bool {
        Plugin::ALL.iter().any(|it| match it.names().under_eslint {
            UnderEslint::InPlaceOf(usual, _) => {
                it.prefix().as_bytes() == prefix
                    && (usual.zip(package))
                        .is_none_or(|(usual, package)| usual.as_bytes() == package)
            }
            UnderEslint::Here | UnderEslint::Package => false,
        })
    }

    /// The version of the package that the rules here do the same as, if they answer in place of one.
    pub fn follows(self) -> Option<&'static str> {
        match self.names().under_eslint {
            UnderEslint::InPlaceOf(_, version) => Some(version),
            UnderEslint::Here | UnderEslint::Package => None,
        }
    }

    /// The plugin of oxlint that has the rules of this one: those of `react-hooks` are in its `react`.
    pub const fn in_oxlint(self) -> Plugin {
        match self {
            Plugin::ReactHooks => Plugin::React,
            plugin => plugin,
        }
    }
}

/// The major and the minor version in `version`.
pub fn minor_of(version: &[u8]) -> Option<(u32, u32)> {
    let mut parts = version.split(|it| *it == b'.');
    let mut number = || std::str::from_utf8(parts.next()?).ok()?.parse().ok();
    Some((number()?, number()?))
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
    /// It is a port of the rule that oxlint has, not of the rule of the plugin for ESLint: the messages, the places, the fixes and
    /// the options are oxlint's. It exists only with a configuration of oxlint.
    pub follows_oxlint: bool,
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
            follows_oxlint: false,
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

    /// A rule of a plugin that is built into oxlint, as oxlint has it: [`Meta::follows_oxlint`].
    pub const fn oxlint(plugin: Plugin, name: &'static str, kind: Kind) -> Meta {
        let mut meta = Meta::new(plugin, name, kind);
        meta.follows_oxlint = true;
        meta
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
    /// One of them is called in the order of the source or at the end.
    pub(crate) has_later: bool,
    file: &'a File<'a>,
}

pub(crate) type Entries<'a, R> = SmallVec<[Kept<'a, R>; 4]>;

/// Calls the listener of an entry with all that it is for.
pub(crate) type Runs<'a, R> = fn(&Entry<'a, R>, &R, &'a File<'a>, &mut Cx<'a, R>);

/// A listener, and what calls it with the nodes in no particular order. `None`: it is called later.
///
/// That is a function for each kind of entry, and not one function with a `match`: see `number_literals` in `runner.rs`.
pub(crate) struct Kept<'a, R: Rule> {
    pub(crate) entry: Entry<'a, R>,
    pub(crate) runs: Option<Runs<'a, R>>,
}

type OnCodePath<'a, R> = fn(&R, CodePath<'a>, Node<'a>, &mut Cx<'a, R>);
type OnSegment<'a, R> = fn(&R, Segment<'a>, Node<'a>, &mut Cx<'a, R>);
type OnSegmentLoop<'a, R> = fn(&R, Segment<'a>, Segment<'a>, Node<'a>, &mut Cx<'a, R>);

macro_rules! sorts {
    ($($(#[$doc:meta])* $method:ident $variant:ident $handle:ident $runs:ident $has_any:expr;)*) => {
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

        impl<'a, R: Rule> Listeners<'a, R> {
            $(
                $(#[$doc])*
                /// In no particular order.
                #[inline]
                pub fn $method(&mut self, listener: Listener<'a, R, $handle<'a>>) {
                    let has_any: fn(&File) -> bool = $has_any;
                    if has_any(self.file) {
                        self.unordered(Entry::$variant(listener), runner::$runs);
                    }
                }
            )*
        }
    };
}

sorts! {
    /// Every function-like: declarations, expressions, arrow functions, methods, accessors,
    /// constructors, static blocks, signatures, function types.
    funcs Funcs Func run_funcs |file| !file.hir.fns.is_empty();
    /// Every class declaration and expression.
    classes Classes Class run_classes |file| !file.hir.classes.is_empty();
    /// Every member of a class, an interface or a type literal.
    members Members Member run_members |file| !file.hir.members.is_empty();
    /// Every property of an object literal and every attribute of a JSX element.
    props Props Prop run_props |file| !file.hir.props.is_empty();
    /// Every parameter.
    params Params Param run_params |file| !file.hir.params.is_empty();
    /// Every type parameter.
    type_params TypeParams TypeParam run_type_params |file| !file.hir.type_params.is_empty();
    /// Every `pat: ty = init` of a variable statement, and every `catch` parameter.
    var_decls VarDecls VarDecl run_var_decls |file| !file.hir.var_decls.is_empty();
    /// Every `case` and `default` clause.
    cases Cases Case run_cases |file| !file.hir.cases.is_empty();
    /// Every member of an enum.
    enum_members EnumMembers EnumMember run_enum_members |file| !file.hir.enum_members.is_empty();
    /// Every `a as b` in the braces of an import.
    import_specs ImportSpecs ImportSpec run_import_specs |file| !file.hir.import_specs.is_empty();
    /// Every `a as b` in the braces of an export.
    export_specs ExportSpecs ExportSpec run_export_specs |file| !file.hir.export_specs.is_empty();
    /// Everything that the file declares in a scope: variables, functions, classes, parameters,
    /// imports, types, namespaces, enums.
    symbols Symbols Symbol run_symbols |_| true;
    /// Every string in quotes, which is a `Literal` for ESLint: not only the expressions, also the keys of properties and
    /// members, literal types, module specifiers, the names in quotes of imports and exports. Not the text in JSX.
    string_literals StringLiterals Literal run_string_literals |_| true;
    /// The same for numbers, including `1n`.
    number_literals NumberLiterals Literal run_number_literals |_| true;
}

impl<'a, R: Rule> Listeners<'a, R> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Listeners {
            entries: SmallVec::new(),
            has_later: false,
            file,
        }
    }

    // Those that follow are not inlined: they look neither into the rule nor into its state, so they are the same code for all
    // rules, of which the linker then keeps one copy. `register` has a call for each kind that it names.

    #[inline(never)]
    fn later(&mut self, entry: Entry<'a, R>) {
        self.has_later = true;
        self.entries.push(Kept { entry, runs: None });
    }

    #[inline(never)]
    fn unordered(&mut self, entry: Entry<'a, R>, runs: Runs<'a, R>) {
        self.entries.push(Kept {
            entry,
            runs: Some(runs),
        });
    }

    #[inline(never)]
    fn one_of_exprs(&mut self, tag: ExprTag, listener: Listener<'a, R, Expr<'a>>) {
        if self.file.has_exprs([tag]) {
            self.unordered(Entry::Exprs(tag, listener), runner::run_exprs);
        }
    }

    #[inline(never)]
    fn one_of_optional_chains(&mut self, tag: ExprTag, listener: Listener<'a, R, Expr<'a>>) {
        if !self.file.chained_exprs_of(tag).is_empty() {
            self.unordered(Entry::Chained(tag, listener), runner::run_chained);
        }
    }

    #[inline(never)]
    fn one_of_binaries(&mut self, tag: BinOp, listener: Listener<'a, R, Expr<'a>>) {
        if !self.file.binaries_of(tag).is_empty() {
            self.unordered(Entry::Binaries(tag, listener), runner::run_binaries);
        }
    }

    #[inline(never)]
    fn one_of_unaries(&mut self, tag: UnOp, listener: Listener<'a, R, Expr<'a>>) {
        if !self.file.unaries_of(tag).is_empty() {
            self.unordered(Entry::Unaries(tag, listener), runner::run_unaries);
        }
    }

    #[inline(never)]
    fn one_of_stmts(&mut self, tag: StmtTag, listener: Listener<'a, R, Stmt<'a>>) {
        if self.file.has_stmts([tag]) {
            self.unordered(Entry::Stmts(tag, listener), runner::run_stmts);
        }
    }

    #[inline(never)]
    fn one_of_types(&mut self, tag: TypeTag, listener: Listener<'a, R, TypeNode<'a>>) {
        if !self.file.types_of(tag).is_empty() {
            self.unordered(Entry::Types(tag, listener), runner::run_types);
        }
    }

    #[inline(never)]
    fn one_of_pats(&mut self, tag: PatTag, listener: Listener<'a, R, Pat<'a>>) {
        if !self.file.pats_of(tag).is_empty() {
            self.unordered(Entry::Pats(tag, listener), runner::run_pats);
        }
    }

    /// Every expression of one of these kinds, in no particular order.
    pub fn exprs(
        &mut self,
        tags: impl IntoIterator<Item = ExprTag>,
        listener: Listener<'a, R, Expr<'a>>,
    ) {
        for tag in tags {
            self.one_of_exprs(tag, listener);
        }
    }

    /// Every `Dot`, `Index` and `Call` that is part of an optional chain ([`Expr::chain`] is not `Chain::No`), in no particular
    /// order: in `a?.b.c()` that is `a?.b`, `a?.b.c` and `a?.b.c()`. Not the `!` in a chain.
    pub fn optional_chains(&mut self, listener: Listener<'a, R, Expr<'a>>) {
        for tag in [ExprTag::Dot, ExprTag::Index, ExprTag::Call] {
            self.one_of_optional_chains(tag, listener);
        }
    }

    /// Every [`ExprKind::Binary`](crate::ast::ExprKind::Binary) with one of these operators, in no particular order. A rule that
    /// is about `==` is not called with the other operators, and not at all in a file without a `==`.
    pub fn binaries(
        &mut self,
        ops: impl IntoIterator<Item = BinOp>,
        listener: Listener<'a, R, Expr<'a>>,
    ) {
        for op in ops {
            self.one_of_binaries(op, listener);
        }
    }

    /// Every [`ExprKind::Unary`](crate::ast::ExprKind::Unary) with one of these operators, in no particular order.
    pub fn unaries(
        &mut self,
        ops: impl IntoIterator<Item = UnOp>,
        listener: Listener<'a, R, Expr<'a>>,
    ) {
        for op in ops {
            self.one_of_unaries(op, listener);
        }
    }

    /// Every statement of one of these kinds, in no particular order.
    pub fn stmts(
        &mut self,
        tags: impl IntoIterator<Item = StmtTag>,
        listener: Listener<'a, R, Stmt<'a>>,
    ) {
        for tag in tags {
            self.one_of_stmts(tag, listener);
        }
    }

    /// Every type of one of these kinds, in no particular order.
    pub fn types(
        &mut self,
        tags: impl IntoIterator<Item = TypeTag>,
        listener: Listener<'a, R, TypeNode<'a>>,
    ) {
        for tag in tags {
            self.one_of_types(tag, listener);
        }
    }

    /// Every binding pattern of one of these kinds, in no particular order.
    pub fn pats(
        &mut self,
        tags: impl IntoIterator<Item = PatTag>,
        listener: Listener<'a, R, Pat<'a>>,
    ) {
        for tag in tags {
            self.one_of_pats(tag, listener);
        }
    }

    /// Every node of one of these kinds, in no particular order: for a rule that learns from its options which kinds it is about.
    pub fn nodes(&mut self, tags: impl Into<NodeTags>, listener: Listener<'a, R, Node<'a>>) {
        self.unordered(Entry::Nodes(tags.into(), listener), runner::run_nodes);
    }

    /// Every node of one of these kinds, in source order, before its children.
    ///
    /// This makes the linter walk the file, which the listeners above do not need.
    pub fn enter(&mut self, tags: impl Into<NodeTags>, listener: Listener<'a, R, Node<'a>>) {
        self.later(Entry::Enter(tags.into(), listener));
    }

    /// Every node of one of these kinds, in source order, after its children.
    pub fn exit(&mut self, tags: impl Into<NodeTags>, listener: Listener<'a, R, Node<'a>>) {
        self.later(Entry::Exit(tags.into(), listener));
    }

    /// Once, after everything else.
    pub fn finish(&mut self, listener: fn(&R, &mut Cx<'a, R>)) {
        self.later(Entry::Finish(listener));
    }

    /// ESLint's `onCodePathStart`. Like all of the following, it is called during the walk, in
    /// order with [`Listeners::enter`] and [`Listeners::exit`].
    pub fn code_path_start(&mut self, listener: OnCodePath<'a, R>) {
        self.later(Entry::CodePathStart(listener));
    }

    /// ESLint's `onCodePathEnd`.
    pub fn code_path_end(&mut self, listener: OnCodePath<'a, R>) {
        self.later(Entry::CodePathEnd(listener));
    }

    /// ESLint's `onCodePathSegmentStart`.
    pub fn segment_start(&mut self, listener: OnSegment<'a, R>) {
        self.later(Entry::SegmentStart(listener));
    }

    /// ESLint's `onCodePathSegmentEnd`.
    pub fn segment_end(&mut self, listener: OnSegment<'a, R>) {
        self.later(Entry::SegmentEnd(listener));
    }

    /// ESLint's `onUnreachableCodePathSegmentStart`.
    pub fn unreachable_segment_start(&mut self, listener: OnSegment<'a, R>) {
        self.later(Entry::UnreachableSegmentStart(listener));
    }

    /// ESLint's `onUnreachableCodePathSegmentEnd`.
    pub fn unreachable_segment_end(&mut self, listener: OnSegment<'a, R>) {
        self.later(Entry::UnreachableSegmentEnd(listener));
    }

    /// ESLint's `onCodePathSegmentLoop`: from the first segment to the second.
    pub fn segment_loop(&mut self, listener: OnSegmentLoop<'a, R>) {
        self.later(Entry::SegmentLoop(listener));
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
