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
//!     const ON: On = On::new().stmts(&[StmtTag::Debugger]);
//!     no_state!();
//!
//!     fn new(_: &Options) -> Self {
//!         NoDebugger
//!     }
//!
//!     fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
//!         cx.report(stmt, UNEXPECTED);
//!     }
//! }
//! ```
//!
//! A rule is created once for each distinct set of options, and shared by all threads. What it
//! listens to is a constant, [`Rule::ON`]: which of its methods are called is known when it is
//! compiled. For each file that has something of that, [`Rule::start`] returns the state that it
//! keeps while the file is linted.
//!
//! How rules are run is designed around the HIR, which stores the nodes of a file in one vector
//! per sort:
//! - [`Rule::expr`], [`Rule::stmt`] and the like are called with every such node of the file, one
//!   sort after the other, each in a tight loop over the nodes of the kinds that `ON` names. There
//!   is no walk over the tree, and no work for a node that nobody listens for. The nodes come **in
//!   no particular order**.
//! - A rule that depends on the order, because it pushes on entering a function and pops on
//!   leaving it, has [`Rule::enter`] and [`Rule::exit`]. The nodes that are listened for so are
//!   put in order once for all rules, and only if there are any. Most rules do not need it: from
//!   any node the way up is a few loads ([`Node::ancestors`](crate::ast::Node::ancestors)).
//! - [`Rule::finish`] is called last.

use crate::ast::{
    BinOp, Case, Class, EnumMember, ExportSpec, Expr, ExprTag, File, Func, ImportSpec, Member,
    Node, Param, Pat, PatTag, Prop, Stmt, StmtTag, TypeNode, TypeParam, TypeTag, UnOp, VarDecl,
};
use crate::context::Cx;
use crate::literal::Literal;
use crate::options::Options;
use crate::semantic::Symbol;
use bun_wyhash::hash_const;

/// A message that a rule reports. `{{name}}` in `text` is replaced by what
/// [`Report::data`](crate::context::Report::data) provides.
#[derive(Copy, Clone, Debug)]
pub struct Message {
    /// ESLint's `messageId`.
    pub id: &'static str,
    pub text: &'static str,
    /// Whether there is a `{{` in `text`.
    pub(crate) may_have_placeholders: bool,
    /// A hash of `id` and `text`. By it and [`Meta::key`], [`oxlint_help`](crate::oxlint_help) finds what belongs to a message of a
    /// rule. Both are constants, and so are these.
    pub(crate) key: u32,
}

const _: () = assert!(size_of::<Message>() == 5 * size_of::<usize>());

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
            key: hash_const(hash_const(0, id.as_bytes()), text.as_bytes()) as u32,
        }
    }
}

/// Who answers for the rules of a plugin in a configuration of ESLint.
#[derive(Copy, Clone, PartialEq, Eq)]
enum UnderEslint {
    /// The rules here, and no configuration, whosever it is, has to name the plugin: those of ESLint itself, and Bun's.
    Always,
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
    has: Has,
}

/// How many of the rules of a plugin exist here. With a part of them, a rule that does not is one of the package, and
/// no mistake.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Has {
    Whole,
    Part,
}

macro_rules! plugins {
    ($($(#[$example:meta])* $plugin:ident: $prefixes:expr, $under_eslint:expr, $has:ident;)*) => {
        /// Where a rule is from. It decides the prefix of its name in a configuration.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        pub enum Plugin {
            $($(#[$example])* $plugin,)*
        }

        impl Plugin {
            pub(crate) const ALL: &'static [Plugin] = &[$(Plugin::$plugin),*];

            const fn names(self) -> Names {
                use UnderEslint::{Always, Here, InPlaceOf, Package};
                match self {
                    $(Plugin::$plugin => Names {
                        prefixes: &$prefixes,
                        under_eslint: $under_eslint,
                        has: Has::$has,
                    },)*
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
    Eslint: ["", "eslint"], Always, Whole;
    /// `@typescript-eslint/no-explicit-any`
    TypeScript: ["@typescript-eslint", "typescript-eslint", "typescript"], InPlaceOf(None, "8.71.1"), Whole;
    /// `react-hooks/rules-of-hooks`
    ReactHooks: ["react-hooks", "react_hooks", "react"], InPlaceOf(Some("eslint-plugin-react-hooks"), "7.1.1"), Part;
    /// `import/no-cycle`
    Import: ["import", "import-x"], InPlaceOf(Some("eslint-plugin-import"), "2.32.0"), Part;
    /// `n/no-unsupported-features/es-syntax`
    Node: ["n", "node"], InPlaceOf(Some("eslint-plugin-n"), "18.4.1"), Part;
    /// `oxc/no-accumulating-spread`
    Oxc: ["oxc"], Here, Part;
    /// `unicorn/no-null`
    Unicorn: ["unicorn"], Package, Part;
    /// `react/jsx-key`
    React: ["react", "react-hooks", "react_hooks"], Package, Part;
    /// `react-perf/jsx-no-new-object-as-prop`
    ReactPerf: ["react-perf", "react_perf"], Package, Part;
    /// `jsx-a11y/alt-text`
    JsxA11y: ["jsx-a11y", "jsx_a11y"], Package, Part;
    /// `@next/next/no-img-element`
    Nextjs: ["@next/next", "nextjs"], Package, Part;
    /// `promise/param-names`
    Promise: ["promise"], Package, Part;
    /// `jest/no-focused-tests`
    Jest: ["jest"], Package, Part;
    /// `vitest/no-focused-tests`
    Vitest: ["vitest"], Package, Part;
    /// `jsdoc/require-param`
    Jsdoc: ["jsdoc"], Package, Part;
    /// `vue/no-dupe-keys`
    Vue: ["vue"], Package, Part;
    /// `bun/no-eager-dynamic-import`
    Bun: ["bun"], Always, Whole;
    /// `prettier/prettier`
    Prettier: ["prettier"], InPlaceOf(Some("eslint-plugin-prettier"), "5.5.6"), Whole;
    /// `regexp/no-dupe-disjunctions`
    Regexp: ["regexp"], Package, Part;
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

    /// Whether its rules can be configured without the plugin being named. A plugin of the project with that name hides
    /// it.
    pub fn is_always_there(self) -> bool {
        self.names().under_eslint == UnderEslint::Always
    }

    pub(crate) fn is_whole(self) -> bool {
        self.names().has == Has::Whole
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
            UnderEslint::Always | UnderEslint::Here | UnderEslint::Package => false,
        })
    }

    /// The version of the package that the rules here do the same as, if they answer in place of one.
    pub fn follows(self) -> Option<&'static str> {
        match self.names().under_eslint {
            UnderEslint::InPlaceOf(_, version) => Some(version),
            UnderEslint::Always | UnderEslint::Here | UnderEslint::Package => None,
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
    let mut parts = bun_core::strings::split(version, b".");
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

/// When the original reports: it decides about the order of what starts at one place.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum When {
    /// In a listener that is called on entering a node: the longer first.
    Entering,
    /// [`Report::shorter_first`](crate::context::Report::shorter_first)
    EnteringShorterFirst,
    /// [`Meta::reports_on_exit`]
    Leaving,
    /// [`Meta::reports_on_code_path_end`]
    LeavingCodePath,
    /// [`Meta::reports_at_the_end`]
    AtTheEnd,
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
    /// The rule stands in for that of a package only for some files: for the others it calls `File::hand_back`, and the
    /// rule of the package is asked.
    pub hands_back: bool,
    pub reports: When,
    /// A hash of `name`.
    pub(crate) key: u32,
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
            hands_back: false,
            reports: When::Entering,
            key: hash_const(0, name.as_bytes()) as u32,
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

    pub const fn hands_back(mut self) -> Meta {
        self.hands_back = true;
        self
    }

    /// Of what starts at one place, what this rule reports comes last, and of that the shorter first: as from a listener that
    /// is called on leaving a node, the inner node first. Without it the longer comes first.
    pub const fn reports_on_exit(mut self) -> Meta {
        self.reports = When::Leaving;
        self
    }

    /// As [`Meta::reports_on_exit`], for a rule that reports when the code path of a function ends: ESLint calls the listeners on
    /// leaving the function first.
    pub const fn reports_on_code_path_end(mut self) -> Meta {
        self.reports = When::LeavingCodePath;
        self
    }

    /// Of what starts at one place, what this rule reports comes after all that is reported for a node, by the order of the rules:
    /// as from a listener that is called when the program ends.
    pub const fn reports_at_the_end(mut self) -> Meta {
        self.reports = When::AtTheEnd;
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

    /// What it listens to: the methods below that are called. A file that has none of it is passed over without a call.
    const ON: On;

    /// What the rule keeps while one file is linted: [`Cx::state`]. [`no_state!`](crate::no_state) writes this line and
    /// [`Rule::start`] for a rule that keeps nothing.
    type State<'a>;

    /// `options`: what follows the severity in the configuration.
    fn new(options: &Options) -> Self;

    /// What is wrong with `options` that the schema of the rule cannot tell, where ESLint's rule throws: the message.
    fn validate(_options: &Options) -> Result<(), Vec<u8>> {
        Ok(())
    }

    /// What of [`Rule::ON`] the rule listens to with its options, in this file: for a rule that is about fewer kinds then, or
    /// about kinds that only its options know. What is not in `ON` does not count: which methods are called is a constant.
    #[inline(always)]
    fn narrow<'a>(&self, _file: &'a File<'a>) -> On {
        Self::ON
    }

    /// Once for each file that has something of that, like ESLint's `create`. `None`: not this file.
    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>>;

    // In no particular order within a kind. The sorts in this order, the kinds of a sort in the order of their `enum`.

    /// Every expression of one of these kinds.
    fn expr<'a>(&self, _expr: Expr<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every `Dot`, `Index` and `Call` that is part of an optional chain ([`Expr::chain`] is not `Chain::No`): in
    /// `a?.b.c()` that is `a?.b`, `a?.b.c` and `a?.b.c()`. Not the `!` in a chain.
    fn optional_chain<'a>(&self, _expr: Expr<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every [`ExprKind::Binary`](crate::ast::ExprKind::Binary) with one of these operators. A rule that is about `==`
    /// is not called with the other operators, and not at all in a file without a `==`.
    fn binary<'a>(&self, _expr: Expr<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every [`ExprKind::Unary`](crate::ast::ExprKind::Unary) with one of these operators.
    fn unary<'a>(&self, _expr: Expr<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every statement of one of these kinds.
    fn stmt<'a>(&self, _stmt: Stmt<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every type of one of these kinds.
    fn ty<'a>(&self, _ty: TypeNode<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every binding pattern of one of these kinds.
    fn pat<'a>(&self, _pat: Pat<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every function-like: declarations, expressions, arrow functions, methods, accessors,
    /// constructors, static blocks, signatures, function types.
    fn func<'a>(&self, _func: Func<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every class declaration and expression.
    fn class<'a>(&self, _class: Class<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every member of a class, an interface or a type literal.
    fn member<'a>(&self, _member: Member<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every property of an object literal and every attribute of a JSX element.
    fn prop<'a>(&self, _prop: Prop<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every parameter.
    fn param<'a>(&self, _param: Param<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every type parameter.
    fn type_param<'a>(&self, _type_param: TypeParam<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every `pat: ty = init` of a variable statement, and every `catch` parameter.
    fn var_decl<'a>(&self, _var_decl: VarDecl<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every `case` and `default` clause.
    fn case<'a>(&self, _case: Case<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every member of an enum.
    fn enum_member<'a>(&self, _enum_member: EnumMember<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every `a as b` in the braces of an import.
    fn import_spec<'a>(&self, _import_spec: ImportSpec<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every `a as b` in the braces of an export.
    fn export_spec<'a>(&self, _export_spec: ExportSpec<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Everything that the file declares in a scope: variables, functions, classes, parameters,
    /// imports, types, namespaces, enums.
    fn symbol<'a>(&self, _symbol: Symbol<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every string in quotes, which is a `Literal` for ESLint: not only the expressions, also the keys of properties and
    /// members, literal types, module specifiers, the names in quotes of imports and exports. Not the text in JSX.
    fn string_literal<'a>(&self, _literal: Literal<'a>, _cx: &mut Cx<'a, Self>) {}
    /// The same for numbers, including `1n`.
    fn number_literal<'a>(&self, _literal: Literal<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every node of one of these kinds: for a rule that learns from its options which kinds it is about.
    fn node<'a>(&self, _node: Node<'a>, _cx: &mut Cx<'a, Self>) {}

    // After those of all rules, in the order of the source.

    /// Every node of one of these kinds, before its children.
    fn enter<'a>(&self, _node: Node<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every node of one of these kinds, after its children.
    fn exit<'a>(&self, _node: Node<'a>, _cx: &mut Cx<'a, Self>) {}

    /// At the end.
    fn finish(&self, _cx: &mut Cx<'_, Self>) {}
}

/// In the `impl` of a [`Rule`] that keeps nothing while a file is linted, and that is for every file.
#[macro_export]
macro_rules! no_state {
    () => {
        type State<'a> = ();

        fn start<'a>(&self, _: &'a $crate::ast::File<'a>) -> Option<()> {
            Some(())
        }
    };
}

/// What a rule listens to: [`Rule::ON`]. Each method here names the method of [`Rule`] that is then called.
///
/// `On::new().exprs(&[ExprTag::Call, ExprTag::New]).binaries(&[BinOp::EqEq]).funcs().finish()`
#[derive(Copy, Clone)]
pub struct On {
    // A bit for each kind.
    pub(crate) exprs: u64,
    pub(crate) binaries: u64,
    pub(crate) unaries: u64,
    pub(crate) stmts: u64,
    pub(crate) types: u64,
    pub(crate) pats: u64,
    /// The constants below.
    sorts: u32,
    pub(crate) nodes: NodeTags,
    pub(crate) enter: NodeTags,
    pub(crate) exit: NodeTags,
}

const _: () = assert!(ExprTag::COUNT <= 64 && StmtTag::COUNT <= 64 && TypeTag::COUNT <= 64);

macro_rules! on_kinds {
    ($($method:ident $called:ident $kind:ident;)*) => {
        $(
            #[doc = concat!("[`Rule::", stringify!($called), "`]")]
            pub const fn $method(mut self, kinds: &[$kind]) -> On {
                let mut at = 0;
                while at < kinds.len() {
                    self.$method |= 1 << kinds[at] as u32;
                    at += 1;
                }
                self
            }
        )*
    };
}

macro_rules! on_sorts {
    ($($method:ident $called:ident $bit:ident $shift:literal;)*) => {
        $(
            pub(crate) const $bit: u32 = 1 << $shift;

            #[doc = concat!("[`Rule::", stringify!($called), "`]")]
            pub const fn $method(mut self) -> On {
                self.sorts |= On::$bit;
                self
            }
        )*
    };
}

impl On {
    pub const fn new() -> On {
        On {
            exprs: 0,
            binaries: 0,
            unaries: 0,
            stmts: 0,
            types: 0,
            pats: 0,
            sorts: 0,
            nodes: NodeTags::EMPTY,
            enter: NodeTags::EMPTY,
            exit: NodeTags::EMPTY,
        }
    }

    on_kinds! {
        exprs expr ExprTag;
        binaries binary BinOp;
        unaries unary UnOp;
        stmts stmt StmtTag;
        types ty TypeTag;
        pats pat PatTag;
    }

    on_sorts! {
        optional_chains optional_chain OPTIONAL_CHAINS 0;
        funcs func FUNCS 1;
        classes class CLASSES 2;
        members member MEMBERS 3;
        props prop PROPS 4;
        params param PARAMS 5;
        type_params type_param TYPE_PARAMS 6;
        var_decls var_decl VAR_DECLS 7;
        cases case CASES 8;
        enum_members enum_member ENUM_MEMBERS 9;
        import_specs import_spec IMPORT_SPECS 10;
        export_specs export_spec EXPORT_SPECS 11;
        symbols symbol SYMBOLS 12;
        string_literals string_literal STRING_LITERALS 13;
        number_literals number_literal NUMBER_LITERALS 14;
        finish finish FINISH 15;
    }

    /// [`Rule::node`]
    pub const fn nodes(mut self, kinds: NodeTags) -> On {
        self.nodes = self.nodes.union(kinds);
        self
    }

    /// [`Rule::enter`]
    pub const fn enter(mut self, kinds: NodeTags) -> On {
        self.enter = self.enter.union(kinds);
        self
    }

    /// [`Rule::exit`]
    pub const fn exit(mut self, kinds: NodeTags) -> On {
        self.exit = self.exit.union(kinds);
        self
    }

    /// The sorts that have kinds: the first row of each, and the one after its last.
    pub(crate) const KINDS: [(usize, usize); 6] = [
        (0, On::BINARIES),
        (On::BINARIES, On::UNARIES),
        (On::UNARIES, On::STMTS),
        (On::STMTS, On::TYPES),
        (On::TYPES, On::PATS),
        (On::PATS, On::SORTS),
    ];
    const BINARIES: usize = ExprTag::COUNT;
    const UNARIES: usize = On::BINARIES + BinOp::Comma as usize + 1;
    const STMTS: usize = On::UNARIES + UnOp::PostDec as usize + 1;
    const TYPES: usize = On::STMTS + StmtTag::COUNT;
    const PATS: usize = On::TYPES + TypeTag::COUNT;
    pub(crate) const SORTS: usize = On::PATS + PatTag::COUNT;
    /// The row of the rules that are started whatever a file has.
    pub const ALWAYS: usize = On::SORTS + 12;
    /// What a file can have or not have: a row for each kind of expression, operator, statement, type and pattern, in
    /// this order, one for each of the sorts from `optional_chains` to `export_specs`, and [`On::ALWAYS`].
    pub const ROWS: usize = On::ALWAYS + 1;

    /// The rows that it names: the first of some rows, and a bit for each from there on.
    pub(crate) const fn rows(self) -> [(usize, u64); 8] {
        let in_every_file = On::SYMBOLS | On::STRING_LITERALS | On::NUMBER_LITERALS;
        let is_always = self.has_later() || self.has(in_every_file) || !self.nodes.is_empty();
        [
            (0, self.exprs),
            (On::BINARIES, self.binaries),
            (On::UNARIES, self.unaries),
            (On::STMTS, self.stmts),
            (On::TYPES, self.types),
            (On::PATS, self.pats),
            (On::SORTS, (self.sorts & 0xfff) as u64),
            (On::ALWAYS, is_always as u64),
        ]
    }

    /// What is in both.
    #[inline]
    pub(crate) const fn and(self, other: &On) -> On {
        On {
            exprs: self.exprs & other.exprs,
            binaries: self.binaries & other.binaries,
            unaries: self.unaries & other.unaries,
            stmts: self.stmts & other.stmts,
            types: self.types & other.types,
            pats: self.pats & other.pats,
            sorts: self.sorts & other.sorts,
            nodes: self.nodes.and(other.nodes),
            enter: self.enter.and(other.enter),
            exit: self.exit.and(other.exit),
        }
    }

    /// `sort`: one or more of the constants.
    #[inline]
    pub(crate) const fn has(self, sort: u32) -> bool {
        self.sorts & sort != 0
    }

    /// Something is called in the order of the source or at the end.
    #[inline]
    pub(crate) const fn has_later(self) -> bool {
        self.has(On::FINISH) || !self.enter.is_empty() || !self.exit.is_empty()
    }
}

/// A set of kinds of nodes, for [`On::nodes`], [`On::enter`] and [`On::exit`].
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

    /// In a constant: `NodeTags::new().exprs(&[ExprTag::Fn]).stmts(&[StmtTag::Block]).union(NodeTags::FUNC)`
    pub const fn new() -> NodeTags {
        NodeTags::EMPTY
    }

    pub const fn exprs(mut self, kinds: &[ExprTag]) -> NodeTags {
        let mut at = 0;
        while at < kinds.len() {
            self.0 |= 1 << kinds[at] as u32;
            at += 1;
        }
        self
    }

    pub const fn stmts(mut self, kinds: &[StmtTag]) -> NodeTags {
        let mut at = 0;
        while at < kinds.len() {
            self.0 |= 1 << (STMTS + kinds[at] as u32);
            at += 1;
        }
        self
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[inline]
    pub const fn union(self, other: NodeTags) -> NodeTags {
        NodeTags(self.0 | other.0)
    }

    #[inline]
    pub(crate) const fn and(self, other: NodeTags) -> NodeTags {
        NodeTags(self.0 & other.0)
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
