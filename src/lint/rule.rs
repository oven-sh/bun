//! The definition of a lint rule.
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
//! A rule is created once per distinct set of options and shared by all threads. What it listens to
//! is a constant, [`Rule::ON`], so which of its methods get called is known at compile time. For
//! each file that has any of those nodes, [`Rule::start`] returns the state that the rule keeps
//! while the file is linted.
//!
//! The way rules run is designed around the HIR, which stores a file's nodes in one vector per sort:
//! - [`Rule::expr`], [`Rule::stmt`] and the like are called with every such node in the file, one
//!   sort after the other, each in a tight loop over the nodes of the kinds listed in `ON`. There's
//!   no tree walk, and no work for a node that no rule listens for. The nodes come **in no
//!   particular order**.
//! - A rule that depends on the order, e.g. because it pushes on entering a function and pops on
//!   leaving it, uses [`Rule::enter`] and [`Rule::exit`]. The nodes with such listeners are sorted
//!   once for all rules, and only if there are any. Most rules don't need this: walking up from any
//!   node takes a few loads ([`Node::ancestors`](crate::ast::Node::ancestors)).
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

/// A message that a rule reports. `{{name}}` in `text` is replaced with the value passed to
/// [`Report::data`](crate::context::Report::data).
#[derive(Copy, Clone, Debug)]
pub struct Message {
    /// ESLint's `messageId`.
    pub id: &'static str,
    pub text: &'static str,
    /// True if `text` contains a `{{`.
    pub(crate) may_have_placeholders: bool,
    /// A hash of `id` and `text`. [`oxlint_help`](crate::oxlint_help) uses it with [`Meta::key`] to look up the help
    /// for a rule's message. `id` and `text` are constants, so both keys are too.
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

/// Which implementation runs a plugin's rules under an ESLint config.
#[derive(Copy, Clone, PartialEq, Eq)]
enum UnderEslint {
    /// The built-in rules, and no tool's config has to list the plugin. These are ESLint's own rules and Bun's.
    Always,
    /// The built-in rules. There's no package that could run instead.
    Here,
    /// The built-in rules, replacing those of the package with this name. The package is still loaded for the rules
    /// that aren't built in. Without a name, it doesn't matter what the config's plugin says it's called. The second
    /// field is the package version that the built-in rules match.
    Replaces(Option<&'static str>, &'static str),
    /// Like `Replaces`, for a plugin that defines [languages](crate::languages) and rules for files in those
    /// languages. Only ESLint has languages, so the plugin doesn't exist with any other config, or without a config.
    Languages(&'static str, &'static str),
    /// The project's package, which has different messages and options. The built-in rules are oxlint's, for an oxlint
    /// config.
    Package,
}

/// A plugin's names, and which implementation runs it.
struct Names {
    /// The prefixes allowed before the `/`. The first one is used in the name that a rule is reported under, and it's
    /// the usual name with ESLint. The others are oxlint's names for the plugin.
    prefixes: &'static [&'static str],
    under_eslint: UnderEslint,
    has: Has,
}

/// How many of a plugin's rules are built in. With `Part`, an unknown rule that's only mentioned in a comment is
/// assumed to belong to the package, so it isn't an error.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Has {
    Whole,
    Part,
    /// oxlint has the plugin built in. Its config can list the plugin and its rules, but they don't run.
    Nothing,
}

macro_rules! plugins {
    ($($(#[$example:meta])* $plugin:ident: $prefixes:expr, $under_eslint:expr, $has:ident;)*) => {
        /// Where a rule comes from. It determines the prefix of the rule's name in a config.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        pub enum Plugin {
            $($(#[$example])* $plugin,)*
        }

        impl Plugin {
            pub(crate) const ALL: &'static [Plugin] = &[$(Plugin::$plugin),*];

            const fn names(self) -> Names {
                use UnderEslint::{Always, Here, Replaces, Languages, Package};
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

// The single source of truth for a plugin's names and which implementation runs it. Looking up a rule by name, reading
// a config's `plugins` and deciding whether to load a package all go through it. oxlint has the `react-hooks` rules in
// `react`. Two other lists answer different questions: the order in which oxlint searches for a name without a prefix
// (`OXLINT_PLUGINS`), and the order in which its rules report at the same node (`order_fixes_as_oxlint`).
plugins! {
    /// `no-debugger`
    Eslint: ["", "eslint"], Always, Whole;
    /// `@typescript-eslint/no-explicit-any`
    TypeScript: ["@typescript-eslint", "typescript-eslint", "typescript"], Replaces(None, "8.71.1"), Whole;
    /// `react-hooks/rules-of-hooks`
    ReactHooks: ["react-hooks", "react_hooks"], Replaces(Some("eslint-plugin-react-hooks"), "7.1.1"), Part;
    /// `import/no-cycle`
    Import: ["import", "import-x"], Replaces(Some("eslint-plugin-import"), "2.32.0"), Part;
    /// `n/no-unsupported-features/es-syntax`
    Node: ["n", "node"], Replaces(Some("eslint-plugin-n"), "18.4.1"), Part;
    /// `oxc/no-accumulating-spread`
    Oxc: ["oxc"], Here, Part;
    /// `unicorn/no-null`
    Unicorn: ["unicorn"], Package, Part;
    /// `react/jsx-key`
    React: ["react", "react-hooks", "react_hooks"], Replaces(Some("eslint-plugin-react"), "7.37.5"), Part;
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
    Jsdoc: ["jsdoc"], Package, Nothing;
    /// `vue/no-dupe-keys`
    Vue: ["vue"], Package, Nothing;
    /// `bun/no-eager-dynamic-import`
    Bun: ["bun"], Always, Whole;
    /// `bun:test/no-focused-tests`
    BunTest: ["bun:test"], Always, Whole;
    /// `prettier/prettier`
    Prettier: ["prettier"], Replaces(Some("eslint-plugin-prettier"), "5.5.6"), Whole;
    /// `json/no-duplicate-keys`
    Json: ["json"], Languages("@eslint/json", "2.1.1"), Whole;
    /// `markdown/no-html`
    Markdown: ["markdown"], Languages("@eslint/markdown", "8.0.3"), Whole;
}

impl Plugin {
    /// The part before the `/` in the name that a rule is reported under. Empty for ESLint's own rules.
    pub const fn prefix(self) -> &'static str {
        match self.names().prefixes.first() {
            Some(prefix) => *prefix,
            None => "",
        }
    }

    fn has_prefix(self, prefix: &[u8]) -> bool {
        self.names()
            .prefixes
            .iter()
            .any(|it| it.as_bytes() == prefix)
    }

    /// True if its rules can be configured without listing the plugin. A project plugin with the same name shadows it.
    pub fn is_always_available(self) -> bool {
        self.names().under_eslint == UnderEslint::Always
    }

    pub(crate) fn is_whole(self) -> bool {
        self.names().has == Has::Whole
    }

    /// True if none of its rules are built in.
    pub fn has_no_rules(self) -> bool {
        self.names().has == Has::Nothing
    }

    fn is_oxlint_only(self) -> bool {
        self.names().under_eslint == UnderEslint::Package
    }

    /// The plugin that a config or comment calls `prefix`, by its usual ESLint name or by one of oxlint's names.
    pub fn from_prefix(prefix: &[u8]) -> Option<Plugin> {
        let all = || {
            Plugin::ALL
                .iter()
                .copied()
                .filter(|it| !it.is_oxlint_only())
        };
        // `react-hooks` is also one of oxlint's names for its `react`.
        all()
            .find(|it| it.prefix().as_bytes() == prefix)
            .or_else(|| all().find(|it| it.has_prefix(prefix)))
    }

    /// Same, for an oxlint config and the comments of a file linted with one. oxlint has more plugins built in. With
    /// ESLint those are packages in the project.
    pub fn from_oxlint_prefix(prefix: &[u8]) -> Option<Plugin> {
        let mut all = Plugin::ALL.iter().copied();
        all.find(|it| it.is_oxlint_only() && it.has_prefix(prefix))
            .or_else(|| Plugin::from_prefix(prefix))
            .filter(|it| !matches!(it.names().under_eslint, UnderEslint::Languages(..)))
            .map(Plugin::in_oxlint)
    }

    /// True if the built-in rules replace the package's for the plugin that an ESLint config registers as `prefix`.
    /// That requires the plugin's usual prefix and the matching package. `package` is the name the plugin reports for
    /// itself, if any.
    pub(crate) fn replaces_package(prefix: &[u8], package: Option<&[u8]>) -> bool {
        Plugin::ALL.iter().any(|it| match it.names().under_eslint {
            UnderEslint::Replaces(usual, _) => {
                it.prefix().as_bytes() == prefix
                    && (usual.zip(package))
                        .is_none_or(|(usual, package)| usual.as_bytes() == package)
            }
            // The prefix alone isn't enough: `json` is also the prefix that ESLint derives from eslint-plugin-json.
            UnderEslint::Languages(usual, _) => {
                it.prefix().as_bytes() == prefix && package == Some(usual.as_bytes())
            }
            UnderEslint::Always | UnderEslint::Here | UnderEslint::Package => false,
        })
    }

    /// True if, with an ESLint config, the built-in rules run for the plugin usually called `prefix`.
    pub fn is_native_under_eslint(prefix: &[u8]) -> bool {
        Plugin::replaces_package(prefix, None)
    }

    /// The package version that the built-in rules match, if they replace a package.
    pub fn follows(self) -> Option<&'static str> {
        match self.names().under_eslint {
            UnderEslint::Replaces(_, version) | UnderEslint::Languages(_, version) => Some(version),
            UnderEslint::Always | UnderEslint::Here | UnderEslint::Package => None,
        }
    }

    /// The package that the built-in rules replace, if they only replace that specific package.
    pub fn package(self) -> Option<&'static str> {
        match self.names().under_eslint {
            UnderEslint::Replaces(package, _) => package,
            UnderEslint::Languages(package, _) => Some(package),
            UnderEslint::Always | UnderEslint::Here | UnderEslint::Package => None,
        }
    }

    /// Prefixes accepted for this plugin's rules when there's no ESLint or oxlint config. Includes every name that either
    /// tool uses. The first one is [`Plugin::prefix`].
    pub const fn spellings(self) -> &'static [&'static str] {
        match self {
            // oxlint accepts both prefixes for both plugins. Here `react-hooks/` only works for the hooks rules.
            Plugin::ReactHooks => &["react-hooks", "react_hooks", "react"],
            Plugin::React => &["react"],
            plugin => match plugin.names().under_eslint {
                UnderEslint::Languages(..) => &[],
                _ => plugin.names().prefixes,
            },
        }
    }

    /// Plugins that accept `prefix` as one of their [spellings](Plugin::spellings).
    pub fn spelled(prefix: &[u8]) -> impl Iterator<Item = Plugin> {
        let has = move |it: &Plugin| it.spellings().iter().any(|it| it.as_bytes() == prefix);
        Plugin::ALL.iter().copied().filter(has)
    }

    /// The framework or test runner this plugin's rules target. Empty for general-purpose plugins.
    pub const fn framework(self) -> Frameworks {
        match self {
            Plugin::React | Plugin::ReactHooks | Plugin::ReactPerf | Plugin::JsxA11y => {
                Frameworks::REACT
            }
            Plugin::Nextjs => Frameworks::NEXT,
            Plugin::Jest => Frameworks::JEST,
            Plugin::Vitest => Frameworks::VITEST,
            _ => Frameworks::empty(),
        }
    }

    /// The oxlint plugin that has this plugin's rules. The `react-hooks` rules are in its `react`.
    pub const fn in_oxlint(self) -> Plugin {
        match self {
            Plugin::ReactHooks => Plugin::React,
            plugin => plugin,
        }
    }
}

bitflags::bitflags! {
    /// Frameworks and test runners that have their own lint plugin. `bun lint` detects them from package.json, so that
    /// `[lint.categories]` doesn't enable Next.js rules in a project that doesn't use Next.js.
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct Frameworks: u8 {
        const REACT = 1 << 0;
        const NEXT = 1 << 1;
        const JEST = 1 << 2;
        const VITEST = 1 << 3;
        /// Not a framework. Set if the nearest package.json has `"type": "module"`. It's a flag here because it's read
        /// from the same file, and config objects test for it the same way.
        const TYPE_MODULE = 1 << 4;
        /// Monorepos usually list these only in the root package.json, so nested packages inherit them.
        const TEST_RUNNERS = Self::JEST.bits() | Self::VITEST.bits();
    }
}

impl Frameworks {
    /// The npm package name for each flag.
    pub const PACKAGES: [(&'static str, Frameworks); 4] = [
        ("react", Frameworks::REACT),
        ("next", Frameworks::NEXT),
        ("jest", Frameworks::JEST),
        ("vitest", Frameworks::VITEST),
    ];
}

/// The major and minor version in `version`.
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
    /// The rule doesn't specify one.
    None,
}

/// ESLint's `meta.fixable`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Fixable {
    No,
    Code,
    Whitespace,
}

bitflags::bitflags! {
    /// The configs published by ESLint and typescript-eslint that enable the rule.
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct Presets: u8 {
        /// `js.configs.recommended`, `tseslint.configs.recommended`
        const RECOMMENDED = 1 << 0;
        /// `tseslint.configs.recommendedTypeChecked`, but not `recommended`
        const RECOMMENDED_TYPE_CHECKED = 1 << 1;
        /// `tseslint.configs.strict`
        const STRICT = 1 << 2;
        const STRICT_TYPE_CHECKED = 1 << 3;
        /// `tseslint.configs.stylistic`
        const STYLISTIC = 1 << 4;
        const STYLISTIC_TYPE_CHECKED = 1 << 5;
    }
}

/// When the original rule reports. This determines the order of reports that start at the same position.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum When {
    /// Before any node, rule by rule: an oxlint rule's `run_once`, or [`Meta::reports_on_creation`].
    Once,
    /// In a listener called on entering a node. Longer nodes come first.
    Entering,
    /// [`Report::by_selector`](crate::context::Report::by_selector)
    EnteringBySelector,
    /// [`Report::shorter_first`](crate::context::Report::shorter_first)
    EnteringShorterFirst,
    /// [`Meta::reports_on_exit`]
    Leaving,
    /// [`Meta::reports_on_code_path_end`]
    LeavingCodePath,
    /// [`Meta::reports_at_the_end`]
    AtTheEnd,
    /// After everything else, longer nodes first. This is for tsgolint's reports.
    Last,
}

/// ESLint's `meta`.
#[derive(Copy, Clone, Debug)]
pub struct Meta {
    /// Without the plugin's prefix.
    pub name: &'static str,
    pub plugin: Plugin,
    pub kind: Kind,
    pub fixable: Fixable,
    pub has_suggestions: bool,
    pub presets: Presets,
    /// The rule only runs on files of a type-checked program, where [`File::types`](crate::ast::File::types) never
    /// fails.
    pub requires_types: bool,
    /// The rule also runs without types, and uses them in files that have them.
    pub uses_types: bool,
    pub is_deprecated: bool,
    /// The ESLint rule that this typescript-eslint rule replaces.
    pub extends_base_rule: Option<&'static str>,
    /// For a rule without types: the typescript-eslint rule that checks the same thing with types. See
    /// [`Pairs`](crate::rule_set::Pairs), which is built from this at compile time.
    pub(crate) with_types: Option<&'static str>,
    /// The rule looks at several files. See [`modules`](crate::modules).
    pub needs_modules: bool,
    /// The rule is a port of oxlint's version, not of the ESLint plugin's, so the messages, locations, fixes and options are
    /// oxlint's. It doesn't exist with an ESLint config. The project's installed package runs there instead.
    pub follows_oxlint: bool,
    /// The rule only replaces a package's rule for some files. For the others it calls `File::hand_back`, and the
    /// package's rule runs.
    pub hands_back: bool,
    /// Upstream sets `fixable`, but the rule never attaches a fix. `--rules` and the docs don't list it as fixable.
    pub never_fixes: bool,
    /// Upstream sets `hasSuggestions`, but the rule never attaches a suggestion.
    pub never_suggests: bool,
    /// [`Meta::hints`]
    pub has_hints: bool,
    /// [`Meta::languages`]
    pub languages: &'static [&'static str],
    /// [`Meta::on_in_any_language`]
    pub is_on_in_any_language: bool,
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
            uses_types: false,
            is_deprecated: false,
            extends_base_rule: None,
            with_types: None,
            needs_modules: false,
            follows_oxlint: false,
            hands_back: false,
            never_fixes: false,
            never_suggests: false,
            has_hints: false,
            languages: &[],
            is_on_in_any_language: false,
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

    /// A rule from another plugin.
    pub const fn plugin(plugin: Plugin, name: &'static str, kind: Kind) -> Meta {
        Meta::new(plugin, name, kind)
    }

    /// A rule from a plugin that's built into oxlint, ported from oxlint's version: [`Meta::follows_oxlint`].
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

    pub const fn never_fixes(mut self) -> Meta {
        self.never_fixes = true;
        self
    }

    pub const fn never_suggests(mut self) -> Meta {
        self.never_suggests = true;
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

    pub const fn uses_types(mut self) -> Meta {
        self.uses_types = true;
        self
    }

    /// True if enabling this rule gets a file type checked, provided the file's config asks for types.
    pub const fn triggers_type_check(&self) -> bool {
        self.requires_types || self.uses_types
    }

    pub const fn needs_modules(mut self) -> Meta {
        self.needs_modules = true;
        self
    }

    pub const fn hands_back(mut self) -> Meta {
        self.hands_back = true;
        self
    }

    /// Some of the rule's reports have a [`Report::hint`](crate::context::Report::hint). Hints aren't shown without this.
    pub const fn hints(mut self) -> Meta {
        self.has_hints = true;
        self
    }

    /// ESLint's `meta.languages`, for a rule about a [language](crate::languages) other than JavaScript, such as
    /// `json/json`. The rule only runs on files in these languages, and it only exists with an ESLint config.
    pub const fn languages(mut self, languages: &'static [&'static str]) -> Meta {
        self.languages = languages;
        self
    }

    /// Upstream's `meta` has no `languages`, so ESLint allows the rule to be enabled for a file in any language. It
    /// reports nothing in a language that isn't in [`Meta::languages`].
    pub const fn on_in_any_language(mut self) -> Meta {
        self.is_on_in_any_language = true;
        self
    }

    /// Among reports that start at the same position, this rule's come before everything reported for a node, in rule
    /// order. That matches reports from `create`, which ESLint calls for every rule before it visits the first node.
    pub const fn reports_on_creation(mut self) -> Meta {
        self.reports = When::Once;
        self
    }

    /// Among reports that start at the same position, this rule's come last, shorter nodes first. That matches a
    /// listener called on leaving a node, where the inner node comes first. Without this, longer nodes come first.
    pub const fn reports_on_exit(mut self) -> Meta {
        self.reports = When::Leaving;
        self
    }

    /// Like [`Meta::reports_on_exit`], for a rule that reports when a function's code path ends. ESLint calls the
    /// listeners for leaving the function first.
    pub const fn reports_on_code_path_end(mut self) -> Meta {
        self.reports = When::LeavingCodePath;
        self
    }

    /// Among reports that start at the same position, this rule's come after everything reported for a node, in rule
    /// order. That matches a listener called at the end of the program.
    pub const fn reports_at_the_end(mut self) -> Meta {
        self.reports = When::AtTheEnd;
        self
    }

    pub const fn deprecated(mut self) -> Meta {
        self.is_deprecated = true;
        self
    }

    /// [`Meta::with_types`]
    pub const fn with_types(mut self, name: &'static str) -> Meta {
        self.with_types = Some(name);
        self
    }

    pub const fn extends_base_rule(mut self, name: &'static str) -> Meta {
        self.extends_base_rule = Some(name);
        self
    }
}

pub trait Rule: Send + Sync + Sized + 'static {
    const META: Meta;

    /// The nodes the rule listens to, which determines which of the methods below are called. A file that has none of
    /// them is skipped without a call.
    const ON: On;

    /// The state the rule keeps while one file is linted: [`Cx::state`]. [`no_state!`](crate::no_state) writes this
    /// line and [`Rule::start`] for a stateless rule.
    type State<'a>;

    /// `options` is whatever follows the severity in the config. It has passed the schema but not yet
    /// [`Rule::validate`], which runs afterwards, so this has to accept anything the schema allows without panicking. A
    /// rule built from options that `validate` rejects never lints anything.
    fn new(options: &Options) -> Self;

    /// Checks `options` for problems that the rule's schema can't express, where ESLint's rule throws. Returns the
    /// message.
    fn validate(_options: &Options) -> Result<(), Vec<u8>> {
        Ok(())
    }

    /// The subset of [`Rule::ON`] that the rule listens to in this file with its options. It's for a rule that needs
    /// fewer kinds in some cases, or whose kinds depend on its options. Anything that isn't in `ON` is ignored, because
    /// the set of called methods is a constant.
    #[inline(always)]
    fn narrow<'a>(&self, _file: &'a File<'a>) -> On {
        Self::ON
    }

    /// Called once for each file that has any of those nodes, like ESLint's `create`. Return `None` to skip the file.
    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>>;

    // Calls come in no particular order within a kind. The sorts come in the order below, and a sort's kinds in `enum`
    // order.

    /// Every expression of one of these kinds.
    fn expr<'a>(&self, _expr: Expr<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every `Dot`, `Index` and `Call` that is part of an optional chain ([`Expr::chain`] is not `Chain::No`): in
    /// `a?.b.c()` that is `a?.b`, `a?.b.c` and `a?.b.c()`. Not the `!` in a chain.
    fn optional_chain<'a>(&self, _expr: Expr<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every [`ExprKind::Binary`](crate::ast::ExprKind::Binary) with one of these operators. A rule about `==` isn't
    /// called with other operators, and isn't called at all in a file without a `==`.
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
    /// Every quoted string, which is a `Literal` for ESLint. Besides expressions, that includes property and member
    /// keys, literal types, module specifiers, and quoted names in imports and exports. It doesn't include JSX text.
    fn string_literal<'a>(&self, _literal: Literal<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Same for numbers, including `1n`.
    fn number_literal<'a>(&self, _literal: Literal<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every node of one of these kinds. For a rule whose kinds depend on its options.
    fn node<'a>(&self, _node: Node<'a>, _cx: &mut Cx<'a, Self>) {}

    // These run after all rules' methods above, in source order.

    /// Every node of one of these kinds, before its children.
    fn enter<'a>(&self, _node: Node<'a>, _cx: &mut Cx<'a, Self>) {}
    /// Every node of one of these kinds, after its children.
    fn exit<'a>(&self, _node: Node<'a>, _cx: &mut Cx<'a, Self>) {}

    /// Called last.
    fn finish(&self, _cx: &mut Cx<'_, Self>) {}
}

/// For the `impl` of a stateless [`Rule`] that runs on every file.
#[macro_export]
macro_rules! no_state {
    () => {
        type State<'a> = ();

        fn start<'a>(&self, _: &'a $crate::ast::File<'a>) -> Option<()> {
            Some(())
        }
    };
}

/// The set of nodes a rule listens to: [`Rule::ON`]. Each method's docs link to the [`Rule`] method that it enables.
///
/// `On::new().exprs(&[ExprTag::Call, ExprTag::New]).binaries(&[BinOp::EqEq]).funcs().finish()`
#[derive(Copy, Clone)]
pub struct On {
    // One bit per kind.
    pub(crate) exprs: u64,
    pub(crate) binaries: u64,
    pub(crate) unaries: u64,
    pub(crate) stmts: u64,
    pub(crate) types: u64,
    pub(crate) pats: u64,
    /// [`On::method_calls`]: one bit per [`name_class`]. Then [`On::function_calls`]: one bit per two classes.
    calls: [u64; 3],
    /// [`On::members_named`]: one bit per [`name_class`].
    members: [u64; 2],
    /// `mention_bit` of each name in `calls` and `members`, and how many there are. If there are more than fit, the
    /// names are unknown.
    mentions: [u16; On::MAX_MENTIONS],
    mention_count: u8,
    /// A combination of the constants below.
    sorts: u32,
    pub(crate) nodes: NodeTags,
    pub(crate) enter: NodeTags,
    pub(crate) exit: NodeTags,
}

const _: () = assert!(ExprTag::COUNT <= 64 && StmtTag::COUNT <= 64 && TypeTag::COUNT <= 64);

/// Number of classes that [`name_class`] distinguishes.
pub(crate) const NAME_CLASSES: usize = 128;

/// A name's class. A file's calls and members are grouped by it. It depends only on the text, so for a name in
/// [`Rule::ON`] it's a compile-time constant, and no name has to be looked up in a file. Different names can have the
/// same class.
#[inline]
pub(crate) const fn name_class(text: &[u8]) -> usize {
    let len = text.len();
    if len == 0 {
        return 0;
    }
    let mixed = (text[0] as u32)
        .wrapping_mul(0x9E37_79B1)
        .wrapping_add((text[len / 2] as u32).wrapping_mul(0x85EB_CA77))
        .wrapping_add((text[len - 1] as u32).wrapping_mul(0xC2B2_AE3D))
        .wrapping_add((len as u32).wrapping_mul(0x27D4_EB2F));
    (mixed >> (u32::BITS - NAME_CLASSES.trailing_zeros())) as usize
}

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
            calls: [0; 3],
            members: [0; 2],
            mentions: [0; On::MAX_MENTIONS],
            mention_count: 0,
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

    /// [`Rule::expr`], with fewer `Call`s than `.exprs(&[ExprTag::Call])`. It's for a rule that ignores a call unless
    /// the callee has one of a few names. The callee is [`Call::callee`](crate::ast::Call::callee), which skips
    /// parentheses and JSDoc casts. Every `Call` in a file is one of three sorts:
    /// - The callee is a `Dot` whose name isn't private: `a.b()`, `a?.b()`, `a.b?.()`, `(a.b)()`, `super.b()`,
    ///   `a.\u0062()`. The rule is called with it if the name, as returned by [`Expr::member_name`], is one of `names`.
    /// - The callee is an identifier: `b()`, `b?.()`, `(b)()`. See [`On::function_calls`].
    /// - Everything else: ``a["b"]()``, ``a[`b`]()``, `a.#b()`, `a.b!()`, `(a.b as T)()`, `(<T>a.b)()`, `a()()`,
    ///   `super()`, `(a || b)()`, `(function () {})()`. The rule is called with all of them.
    ///
    /// `new a.b()`, ``a.b`c` `` and `import()` aren't `Call`s.
    ///
    /// **The rule still has to compare the name.** Calls are grouped by name class, so the rule is also called with a
    /// few calls of other names. The calls arrive in the same order and at the same point as they would with every
    /// `Call` enabled. The rule isn't started in a file that has none of them. A file that [mentions](File::mentions)
    /// none of up to 12 names is only searched for calls of the third sort.
    ///
    /// With `.exprs(&[ExprTag::Call])` as well, the rule is called with every call. If a rule has that in its `ON`, its
    /// [`Rule::narrow`] can list methods and functions that come from its options.
    pub const fn method_calls(mut self, names: &[&str]) -> On {
        let mut at = 0;
        while at < names.len() {
            self = self.method_call(names[at].as_bytes());
            at += 1;
        }
        self
    }

    /// [`On::method_calls`] with one name.
    pub const fn method_call(mut self, name: &[u8]) -> On {
        let class = name_class(name);
        self.calls[class / 64] |= 1 << (class % 64);
        self.with_mention_of(name)
    }

    const MAX_MENTIONS: usize = 12;

    const fn with_mention_of(mut self, name: &[u8]) -> On {
        let (bit, count) = (
            bun_sema::hir::mention_bit(name) as u16,
            self.mention_count as usize,
        );
        let mut at = 0;
        while at < count && at < On::MAX_MENTIONS {
            if self.mentions[at] == bit {
                return self;
            }
            at += 1;
        }
        if count < On::MAX_MENTIONS {
            self.mentions[count] = bit;
        }
        self.mention_count = self.mention_count.saturating_add(1);
        self
    }

    /// `mention_bit` of each name that a `Call` or `Dot` selected by name can have. `None` if that's unknown.
    #[inline]
    pub(crate) fn mentions(&self) -> Option<&[u16]> {
        self.mentions.get(..self.mention_count as usize)
    }

    /// Like [`On::method_calls`], and can be combined with it: the `Call`s whose callee is an identifier in `names`.
    /// With only one of the two, the rule isn't called with calls of the other sort.
    pub const fn function_calls(mut self, names: &[&str]) -> On {
        let mut at = 0;
        while at < names.len() {
            self = self.function_call(names[at].as_bytes());
            at += 1;
        }
        self
    }

    /// [`On::function_calls`] with one name.
    pub const fn function_call(mut self, name: &[u8]) -> On {
        self.calls[2] |= 1 << (name_class(name) % 64);
        self.with_mention_of(name)
    }

    /// [`On::method_calls`] and [`On::function_calls`] with the same names: `a.b()` and `b()`.
    pub const fn calls_named(self, names: &[&str]) -> On {
        self.method_calls(names).function_calls(names)
    }

    /// [`Rule::expr`], with fewer `Dot`s than `.exprs(&[ExprTag::Dot])`: those whose name, as returned by
    /// [`Expr::member_name`], is one of `names`, plus all with a private name (`a.#b`). As with [`On::method_calls`],
    /// the rule still has to compare the name, the order is the same as with every `Dot` enabled, and adding
    /// `.exprs(&[ExprTag::Dot])` enables all of them.
    pub const fn members_named(mut self, names: &[&str]) -> On {
        let mut at = 0;
        while at < names.len() {
            self = self.member_named(names[at].as_bytes());
            at += 1;
        }
        self
    }

    /// [`On::members_named`] with one name.
    pub const fn member_named(mut self, name: &[u8]) -> On {
        let class = name_class(name);
        self.members[class / 64] |= 1 << (class % 64);
        self.with_mention_of(name)
    }

    /// The groups of `Call`s by name that the rule is called with: see `runner::ByName`. All zero if it's called with
    /// every `Call` or with none.
    #[inline]
    pub(crate) const fn call_name_groups(self) -> [u64; 4] {
        let [low, high, functions] = self.calls;
        match !self.has_expr(ExprTag::Call) && low | high | functions != 0 {
            true => [low, high, functions, 1],
            false => [0; 4],
        }
    }

    /// Same for `Dot`s.
    #[inline]
    pub(crate) const fn member_name_groups(self) -> [u64; 4] {
        let [low, high] = self.members;
        match !self.has_expr(ExprTag::Dot) && low | high != 0 {
            true => [low, high, 0, 1],
            false => [0; 4],
        }
    }

    #[inline]
    const fn has_expr(self, kind: ExprTag) -> bool {
        self.exprs & (1 << kind as u32) != 0
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

    /// The sorts that have kinds: each one's first row, and the row after its last.
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
    /// The row for rules that are started regardless of what a file contains.
    pub const ALWAYS: usize = On::SORTS + 12;
    /// Things a file can have or lack: one row per kind of expression, operator, statement, type and pattern, in this
    /// order, one per sort from `optional_chains` to `export_specs`, and [`On::ALWAYS`].
    pub const ROWS: usize = On::ALWAYS + 1;

    /// The rows this `On` selects, as pairs of a starting row and a bitmask of the rows from there on.
    pub(crate) const fn rows(self) -> [(usize, u64); 8] {
        let in_every_file = On::SYMBOLS | On::STRING_LITERALS | On::NUMBER_LITERALS;
        let is_always = self.has_later() || self.has(in_every_file) || !self.nodes.is_empty();
        let named = ((self.call_name_groups()[3]) << ExprTag::Call as u32)
            | ((self.member_name_groups()[3]) << ExprTag::Dot as u32);
        [
            (0, self.exprs | named),
            (On::BINARIES, self.binaries),
            (On::UNARIES, self.unaries),
            (On::STMTS, self.stmts),
            (On::TYPES, self.types),
            (On::PATS, self.pats),
            (On::SORTS, (self.sorts & 0xfff) as u64),
            (On::ALWAYS, is_always as u64),
        ]
    }

    /// The intersection of the two.
    #[inline]
    pub(crate) const fn and(self, other: &On) -> On {
        // Listening to a whole kind is the same as listening to every name.
        let (calls, other_calls) = (
            match self.has_expr(ExprTag::Call) {
                true => [u64::MAX; 3],
                false => self.calls,
            },
            match other.has_expr(ExprTag::Call) {
                true => [u64::MAX; 3],
                false => other.calls,
            },
        );
        let (members, other_members) = (
            match self.has_expr(ExprTag::Dot) {
                true => [u64::MAX; 2],
                false => self.members,
            },
            match other.has_expr(ExprTag::Dot) {
                true => [u64::MAX; 2],
                false => other.members,
            },
        );
        // Whatever one side selects by name is among that side's names, so its mentions still cover the intersection.
        let (all_calls, all_members) = (self.has_expr(ExprTag::Call), self.has_expr(ExprTag::Dot));
        let (other_all_calls, other_all_members) =
            (other.has_expr(ExprTag::Call), other.has_expr(ExprTag::Dot));
        let (mentions, mention_count) =
            if (!other_all_calls || all_calls) && (!other_all_members || all_members) {
                (other.mentions, other.mention_count)
            } else if (!all_calls || other_all_calls) && (!all_members || other_all_members) {
                (self.mentions, self.mention_count)
            } else {
                (self.mentions, u8::MAX)
            };
        On {
            exprs: self.exprs & other.exprs,
            binaries: self.binaries & other.binaries,
            unaries: self.unaries & other.unaries,
            stmts: self.stmts & other.stmts,
            types: self.types & other.types,
            pats: self.pats & other.pats,
            calls: [
                calls[0] & other_calls[0],
                calls[1] & other_calls[1],
                calls[2] & other_calls[2],
            ],
            members: [members[0] & other_members[0], members[1] & other_members[1]],
            mentions,
            mention_count,
            sorts: self.sorts & other.sorts,
            nodes: self.nodes.and(other.nodes),
            enter: self.enter.and(other.enter),
            exit: self.exit.and(other.exit),
        }
    }

    /// `sort` is one or more of the constants.
    #[inline]
    pub(crate) const fn has(self, sort: u32) -> bool {
        self.sorts & sort != 0
    }

    /// True if any method runs in source order or at the end.
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

    /// For use in a constant: `NodeTags::new().exprs(&[ExprTag::Fn]).stmts(&[StmtTag::Block]).union(NodeTags::FUNC)`
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

    /// The index of the lowest set bit. For a single kind, that's what [`NodeTags::index_of`] returns for a node of
    /// that kind.
    #[inline]
    pub(crate) const fn first_index(self) -> u32 {
        self.0.trailing_zeros()
    }

    /// The indexes of the set bits. See [`NodeTags::index_of`].
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

    /// The bit index for `node`'s kind.
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
