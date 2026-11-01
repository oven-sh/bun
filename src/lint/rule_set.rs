//! A linter's set of rules, as a type. Everything about the set is known at compile time.
//!
//! Every rule has a number: its crate's offset, which is a multiple of 64, plus its index in that crate's
//! [`rules!`](crate::rules). A set of rules is a [`RuleBits`]. [`rules!`](crate::rules) generates one `enum` of a
//! crate's rules and one of their runs, and [`rule_sets!`](crate::rule_sets) joins those of several crates into a
//! [`RuleSet`].

use crate::options::Options;
use crate::rule::{Meta, On, Plugin, Rule};
use crate::runner::Starts;
use bun_core::strings::const_str_eq;

/// A set of rules, by number.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct RuleBits(pub [u64; RuleBits::WORDS]);

impl RuleBits {
    /// [`rule_sets!`](crate::rule_sets) asserts that the rules fit.
    pub const WORDS: usize = 24;
    pub const EMPTY: RuleBits = RuleBits([0; RuleBits::WORDS]);

    #[inline]
    pub const fn insert(&mut self, rule: u16) {
        self.0[rule as usize / 64] |= 1 << (rule % 64);
    }

    #[inline]
    pub const fn has(&self, rule: u16) -> bool {
        self.0[rule as usize / 64] & (1 << (rule % 64)) != 0
    }

    #[inline]
    pub(crate) const fn intersects(&self, other: &RuleBits) -> bool {
        let mut word = 0;
        while word < RuleBits::WORDS {
            if self.0[word] & other.0[word] != 0 {
                return true;
            }
            word += 1;
        }
        false
    }

    #[inline]
    pub const fn or(mut self, other: &RuleBits) -> RuleBits {
        let mut word = 0;
        while word < RuleBits::WORDS {
            self.0[word] |= other.0[word];
            word += 1;
        }
        self
    }
}

/// An instance of one of a linter's rules.
pub trait RuleSet: Starts + Sized + 'static {
    /// Indexed by rule number. `None` if no rule has the number.
    const METAS: &'static [Option<&'static Meta>];
    /// For each row of [`On::ROWS`], the rules whose [`Rule::ON`](crate::rule::Rule::ON) selects it.
    const LISTENS: &'static [RuleBits; On::ROWS];
    /// For each of [`On::KINDS`], the rules that select one of its rows.
    const LISTENS_TO_KINDS: &'static [RuleBits; On::KINDS.len()] = &listens_to_kinds(Self::LISTENS);
    const PAIRS: &'static Pairs = &Pairs::of(Self::METAS);

    /// [`Rule::new`](crate::rule::Rule::new). `None` if no rule has the number.
    fn build(rule: u16, options: &Options) -> Option<Self>;
    /// [`Rule::validate`](crate::rule::Rule::validate)
    fn validate(rule: u16, options: &Options) -> Result<(), Vec<u8>>;
    /// The rule's number.
    fn number(&self) -> u16;
}

/// The untyped rules whose check a typescript-eslint rule also does with types: the core rule it extends, and unicorn's
/// rule for the same code. A problem is only reported once. With an `.oxlintrc.json` and types for the file, where both
/// rules are on, the typed rule [claims](crate::context::Report::claims) each node it reports, and the other rule's
/// reports for that node [aren't shown](crate::context::Report::unless_claimed). Neither rule knows what the other
/// checks.
pub struct Pairs {
    pub(crate) without_types: RuleBits,
    /// For each of them, indexed by its number: the typed rule's number.
    pub(crate) typed: [u16; NUMBERS],
}

impl Pairs {
    const fn of(metas: &[Option<&'static Meta>]) -> Pairs {
        let mut pairs = Pairs {
            without_types: RuleBits::EMPTY,
            typed: [u16::MAX; NUMBERS],
        };
        let mut typed = 0;
        while typed < metas.len() {
            let with_types = match metas[typed] {
                Some(it) if it.requires_types && matches!(it.plugin, Plugin::TypeScript) => it,
                _ => {
                    typed += 1;
                    continue;
                }
            };
            let mut number = 0;
            while number < metas.len() {
                if let Some(it) = metas[number]
                    && !it.requires_types
                {
                    let is_pair = match (it.with_types, with_types.extends_base_rule) {
                        (Some(name), _) => const_str_eq(name, with_types.name),
                        (None, Some(base)) => {
                            matches!(it.plugin, Plugin::Eslint) && const_str_eq(base, it.name)
                        }
                        (None, None) => false,
                    };
                    if is_pair {
                        pairs.without_types.insert(number as u16);
                        pairs.typed[number] = typed as u16;
                    }
                }
                number += 1;
            }
            typed += 1;
        }
        pairs
    }
}

const fn listens_to_kinds(rows: &[RuleBits; On::ROWS]) -> [RuleBits; On::KINDS.len()] {
    let mut all = [RuleBits::EMPTY; On::KINDS.len()];
    let mut sort = 0;
    while sort < all.len() {
        let (mut row, end) = On::KINDS[sort];
        while row < end {
            all[sort] = all[sort].or(&rows[row]);
            row += 1;
        }
        sort += 1;
    }
    all
}

/// For [`rules!`](crate::rules): for each row, the rules in `ons` that select it, by index, 64 to a word.
pub const fn listens<const COUNT: usize, const WORDS: usize>(
    ons: &[On; COUNT],
) -> [[u64; WORDS]; On::ROWS] {
    let mut rows = [[0; WORDS]; On::ROWS];
    let mut local_index = 0;
    while local_index < COUNT {
        let named = ons[local_index].rows();
        let mut sort = 0;
        while sort < named.len() {
            let (first, mut kinds) = named[sort];
            while kinds != 0 {
                rows[first + kinds.trailing_zeros() as usize][local_index / 64] |=
                    1 << (local_index % 64);
                kinds &= kinds - 1;
            }
            sort += 1;
        }
        local_index += 1;
    }
    rows
}

/// For [`rule_sets!`](crate::rule_sets): `all`, with the rows of a crate whose offset is `64 * word` filled in.
pub const fn with_rows<const WORDS: usize>(
    mut all: [RuleBits; On::ROWS],
    rows: &[[u64; WORDS]; On::ROWS],
    word: usize,
) -> [RuleBits; On::ROWS] {
    let mut row = 0;
    while row < On::ROWS {
        let mut at = 0;
        while at < WORDS {
            all[row].0[word + at] = rows[row][at];
            at += 1;
        }
        row += 1;
    }
    all
}

/// The number of possible rule numbers.
pub const NUMBERS: usize = 64 * RuleBits::WORDS;

/// For [`rule_sets!`](crate::rule_sets): `all`, with the rules of a crate at `offset` filled in.
pub const fn with_metas<const COUNT: usize>(
    mut all: [Option<&'static Meta>; NUMBERS],
    metas: &[&'static Meta; COUNT],
    offset: usize,
) -> [Option<&'static Meta>; NUMBERS] {
    let mut local_index = 0;
    while local_index < COUNT {
        all[offset + local_index] = Some(metas[local_index]);
        local_index += 1;
    }
    all
}

/// For [`rule_sets!`](crate::rule_sets): the offset of crate number `at`, given each crate's rule count in `counts`.
pub const fn offset_of(counts: &[usize], at: usize) -> usize {
    let (mut offset, mut before) = (0, 0);
    while before < at {
        offset += counts[before].next_multiple_of(64);
        before += 1;
    }
    offset
}

/// For [`rules!`](crate::rules). Not inlined, so that the caller, which has a branch for each of several hundred rules,
/// doesn't need stack space for any of them.
#[doc(hidden)]
#[inline(never)]
pub fn boxed<R: Rule>(options: &Options) -> Box<R> {
    Box::new(R::new(options))
}

/// Everything that [`rules!`](crate::rules) generates besides the modules.
#[doc(hidden)]
#[macro_export]
macro_rules! rules_as_a_set {
    ($($module:ident::$rule:ident,)*) => {
        /// An instance of one of this crate's rules. The variants are named after the rules' modules.
        #[allow(non_camel_case_types, clippy::enum_variant_names)]
        pub enum Rules {
            $($module(Box<rules::$module::$rule>),)*
        }

        /// One of them running on a file.
        #[allow(non_camel_case_types, clippy::enum_variant_names)]
        pub enum Runs<'r, 'a> {
            $($module(Box<$crate::runner::Later<'r, 'a, rules::$module::$rule>>),)*
        }

        #[allow(non_camel_case_types, clippy::enum_variant_names)]
        #[derive(Copy, Clone)]
        #[repr(u16)]
        enum LocalIndex {
            $($module,)*
        }

        impl Rules {
            pub const COUNT: usize = [$(LocalIndex::$module),*].len();
            /// Indexed by `local_index`.
            pub const METAS: [&'static $crate::rule::Meta; Rules::COUNT] =
                [$(&<rules::$module::$rule as $crate::rule::Rule>::META),*];
            /// `RuleSet::LISTENS`, indexed by `local_index`.
            pub const LISTENS: [[u64; Rules::COUNT.div_ceil(64)]; $crate::rule::On::ROWS] =
                $crate::rule_set::listens(&[$(<rules::$module::$rule as $crate::rule::Rule>::ON),*]);

            #[inline]
            pub fn build(local_index: u16, options: &$crate::options::Options) -> Option<Rules> {
                $(if local_index == LocalIndex::$module as u16 {
                    return Some(Rules::$module($crate::rule_set::boxed(options)));
                })*
                None
            }

            #[inline]
            pub fn validate(local_index: u16, options: &$crate::options::Options) -> Result<(), Vec<u8>> {
                $(if local_index == LocalIndex::$module as u16 {
                    return <rules::$module::$rule as $crate::rule::Rule>::validate(options);
                })*
                Ok(())
            }

            #[inline]
            pub fn local_index(&self) -> u16 {
                match self {
                    $(Rules::$module(_) => LocalIndex::$module as u16,)*
                }
            }
        }

        impl $crate::runner::Starts for Rules {
            type Run<'r, 'a: 'r> = Runs<'r, 'a>;

            #[inline]
            fn start<'r, 'a: 'r>(
                &'r self,
                start: $crate::runner::Start<'a>,
            ) -> Option<Runs<'r, 'a>> {
                match self {
                    $(Rules::$module(rule) => {
                        $crate::runner::start::<rules::$module::$rule>(rule, start).map(Runs::$module)
                    })*
                }
            }
        }

        impl<'a> $crate::runner::Running<'a> for Runs<'_, 'a> {
            #[inline]
            fn walks(&self) -> ($crate::rule::NodeTags, $crate::rule::NodeTags) {
                match self {
                    $(Runs::$module(run) => run.walks(),)*
                }
            }

            #[inline]
            fn enter(&mut self, node: $crate::ast::Node<'a>) {
                match self {
                    $(Runs::$module(run) => run.enter(node),)*
                }
            }

            #[inline]
            fn exit(&mut self, node: $crate::ast::Node<'a>) {
                match self {
                    $(Runs::$module(run) => run.exit(node),)*
                }
            }

            #[inline]
            fn finish(&mut self) {
                match self {
                    $(Runs::$module(run) => run.finish(),)*
                }
            }
        }
    };
}

/// Joins the rules of several crates, each of which has a [`rules!`](crate::rules), into a [`RuleSet`]:
/// `rule_sets! { pub enum Rules / Runs { eslint: bun_lint_eslint, typescript: bun_lint_typescript, } }`.
#[macro_export]
macro_rules! rule_sets {
    ($visibility:vis enum $rules:ident / $runs:ident { $($name:ident: $from:ident,)* }) => {
        /// An instance of a rule.
        #[allow(non_camel_case_types)]
        $visibility enum $rules {
            $($name($from::Rules),)*
        }

        /// A rule running on a file.
        #[allow(non_camel_case_types)]
        $visibility enum $runs<'r, 'a> {
            $($name($from::Runs<'r, 'a>),)*
        }

        #[allow(non_camel_case_types)]
        #[derive(Copy, Clone)]
        enum Crate {
            $($name,)*
        }

        const COUNTS: &[usize] = &[$($from::Rules::COUNT),*];

        impl Crate {
            /// The number of its first rule.
            const fn offset(self) -> usize {
                $crate::rule_set::offset_of(COUNTS, self as usize)
            }
        }

        const _: () = assert!(
            $crate::rule_set::offset_of(COUNTS, COUNTS.len()) <= $crate::rule_set::NUMBERS
        );

        impl $crate::rule_set::RuleSet for $rules {
            const METAS: &'static [Option<&'static $crate::rule::Meta>] = &{
                let all = [None; $crate::rule_set::NUMBERS];
                $(let all = $crate::rule_set::with_metas(all, &$from::Rules::METAS, Crate::$name.offset());)*
                all
            };
            const LISTENS: &'static [$crate::rule_set::RuleBits; $crate::rule::On::ROWS] = &{
                let all = [$crate::rule_set::RuleBits::EMPTY; $crate::rule::On::ROWS];
                $(let all =
                    $crate::rule_set::with_rows(all, &$from::Rules::LISTENS, Crate::$name.offset() / 64);)*
                all
            };

            #[inline]
            fn build(rule: u16, options: &$crate::options::Options) -> Option<Self> {
                $(if let Some(local_index) = (rule as usize).checked_sub(Crate::$name.offset())
                    && local_index < $from::Rules::COUNT
                {
                    return $from::Rules::build(local_index as u16, options).map($rules::$name);
                })*
                None
            }

            #[inline]
            fn validate(rule: u16, options: &$crate::options::Options) -> Result<(), Vec<u8>> {
                $(if let Some(local_index) = (rule as usize).checked_sub(Crate::$name.offset())
                    && local_index < $from::Rules::COUNT
                {
                    return $from::Rules::validate(local_index as u16, options);
                })*
                Ok(())
            }

            #[inline]
            fn number(&self) -> u16 {
                match self {
                    $($rules::$name(rule) => Crate::$name.offset() as u16 + rule.local_index(),)*
                }
            }
        }

        impl $crate::runner::Starts for $rules {
            type Run<'r, 'a: 'r> = $runs<'r, 'a>;

            #[inline]
            fn start<'r, 'a: 'r>(
                &'r self,
                start: $crate::runner::Start<'a>,
            ) -> Option<$runs<'r, 'a>> {
                match self {
                    $($rules::$name(rule) => $crate::runner::Starts::start(rule, start).map($runs::$name),)*
                }
            }
        }

        impl<'a> $crate::runner::Running<'a> for $runs<'_, 'a> {
            #[inline]
            fn walks(&self) -> ($crate::rule::NodeTags, $crate::rule::NodeTags) {
                match self {
                    $($runs::$name(run) => run.walks(),)*
                }
            }

            #[inline]
            fn enter(&mut self, node: $crate::ast::Node<'a>) {
                match self {
                    $($runs::$name(run) => run.enter(node),)*
                }
            }

            #[inline]
            fn exit(&mut self, node: $crate::ast::Node<'a>) {
                match self {
                    $($runs::$name(run) => run.exit(node),)*
                }
            }

            #[inline]
            fn finish(&mut self) {
                match self {
                    $($runs::$name(run) => run.finish(),)*
                }
            }
        }
    };
}
