//! The rules that a linter has, as a type: nothing about them is found out while it runs.
//!
//! Every rule has a number: the offset of its crate, which is a multiple of 64, and its place in the
//! [`rules!`](crate::rules) of that crate. A set of rules is a [`RuleBits`]. [`rules!`](crate::rules) makes an `enum`
//! of the rules of a crate and one of their runs, [`rule_sets!`](crate::rule_sets) joins those of several crates to a
//! [`RuleSet`].

use crate::options::Options;
use crate::rule::{Meta, On};
use crate::runner::Starts;

/// A set of rules, by their numbers.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct RuleBits(pub [u64; RuleBits::WORDS]);

impl RuleBits {
    /// [`rule_sets!`](crate::rule_sets) sees to it that the rules fit.
    pub const WORDS: usize = 24;
    pub const EMPTY: RuleBits = RuleBits([0; RuleBits::WORDS]);

    #[inline]
    pub const fn with(mut self, rule: u16) -> RuleBits {
        self.0[rule as usize / 64] |= 1 << (rule % 64);
        self
    }

    #[inline]
    pub const fn has(&self, rule: u16) -> bool {
        self.0[rule as usize / 64] & (1 << (rule % 64)) != 0
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

    #[inline]
    pub const fn and(mut self, other: &RuleBits) -> RuleBits {
        let mut word = 0;
        while word < RuleBits::WORDS {
            self.0[word] &= other.0[word];
            word += 1;
        }
        self
    }

    #[inline]
    pub const fn is_empty(&self) -> bool {
        let (mut any, mut word) = (0, 0);
        while word < RuleBits::WORDS {
            any |= self.0[word];
            word += 1;
        }
        any == 0
    }

    /// What is in this one and not in `other`.
    #[inline]
    pub const fn and_not(mut self, other: &RuleBits) -> RuleBits {
        let mut word = 0;
        while word < RuleBits::WORDS {
            self.0[word] &= !other.0[word];
            word += 1;
        }
        self
    }

    /// The numbers, from the lowest.
    pub fn iter(&self) -> impl Iterator<Item = u16> {
        let some = |word: u64| Some(word).filter(|it| *it != 0);
        (0u16..).step_by(64).zip(self.0).flat_map(move |it| {
            std::iter::successors(some(it.1), move |word| some(word & (word - 1)))
                .map(move |word| it.0 + word.trailing_zeros() as u16)
        })
    }
}

/// An instance of one of the rules that a linter has.
pub trait RuleSet: Starts + Sized + 'static {
    /// By the number. `None`: no rule has it.
    const METAS: &'static [Option<&'static Meta>];
    /// For each row of [`On::ROWS`], the rules whose [`Rule::ON`](crate::rule::Rule::ON) names it.
    const LISTENS: &'static [RuleBits; On::ROWS];
    /// For each of [`On::KINDS`], the rules that name a row of it.
    const LISTENS_TO_KINDS: [RuleBits; On::KINDS.len()] = of_kinds(Self::LISTENS);

    /// [`Rule::new`](crate::rule::Rule::new). `None`: no rule has the number.
    fn build(rule: u16, options: &Options) -> Option<Self>;
    /// [`Rule::validate`](crate::rule::Rule::validate)
    fn validate(rule: u16, options: &Options) -> Result<(), Vec<u8>>;
    /// Its number.
    fn number(&self) -> u16;
}

const fn of_kinds(rows: &[RuleBits; On::ROWS]) -> [RuleBits; On::KINDS.len()] {
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

/// For [`rules!`](crate::rules): for each row, the rules of `ons` that name it, by their places: 64 to a word.
pub const fn listens<const COUNT: usize, const WORDS: usize>(
    ons: &[On; COUNT],
) -> [[u64; WORDS]; On::ROWS] {
    let mut rows = [[0; WORDS]; On::ROWS];
    let mut place = 0;
    while place < COUNT {
        let named = ons[place].rows();
        let mut sort = 0;
        while sort < named.len() {
            let (first, mut kinds) = named[sort];
            while kinds != 0 {
                rows[first + kinds.trailing_zeros() as usize][place / 64] |= 1 << (place % 64);
                kinds &= kinds - 1;
            }
            sort += 1;
        }
        place += 1;
    }
    rows
}

/// For [`rule_sets!`](crate::rule_sets): `all`, with the rows of a crate whose offset is `64 * word`.
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

/// All the numbers that there can be.
pub const NUMBERS: usize = 64 * RuleBits::WORDS;

/// For [`rule_sets!`](crate::rule_sets): `all`, with the rules of a crate whose offset is `offset`.
pub const fn with_metas<const COUNT: usize>(
    mut all: [Option<&'static Meta>; NUMBERS],
    metas: &[&'static Meta; COUNT],
    offset: usize,
) -> [Option<&'static Meta>; NUMBERS] {
    let mut place = 0;
    while place < COUNT {
        all[offset + place] = Some(metas[place]);
        place += 1;
    }
    all
}

/// For [`rule_sets!`](crate::rule_sets): the offset of the crate at `at` of those that have `counts` rules.
pub const fn offset_of(counts: &[usize], at: usize) -> usize {
    let (mut offset, mut before) = (0, 0);
    while before < at {
        offset += counts[before].next_multiple_of(64);
        before += 1;
    }
    offset
}

/// What [`rules!`](crate::rules) writes besides the modules.
#[doc(hidden)]
#[macro_export]
macro_rules! rules_as_a_set {
    ($($module:ident::$rule:ident,)*) => {
        /// An instance of one of the rules of this crate. They have the names of their modules.
        #[allow(non_camel_case_types, clippy::large_enum_variant, clippy::enum_variant_names)]
        pub enum Rules {
            $($module(rules::$module::$rule),)*
        }

        /// One of them at work on a file.
        #[allow(non_camel_case_types, clippy::enum_variant_names)]
        pub enum Runs<'r, 'a> {
            $($module(Box<$crate::runner::Later<'r, 'a, rules::$module::$rule>>),)*
        }

        #[allow(non_camel_case_types, clippy::enum_variant_names)]
        #[derive(Copy, Clone)]
        #[repr(u16)]
        enum Place {
            $($module,)*
        }

        impl Rules {
            pub const COUNT: usize = [$(Place::$module),*].len();
            /// By the place.
            pub const METAS: [&'static $crate::rule::Meta; Rules::COUNT] =
                [$(&<rules::$module::$rule as $crate::rule::Rule>::META),*];
            /// `RuleSet::LISTENS`, by the place.
            pub const LISTENS: [[u64; Rules::COUNT.div_ceil(64)]; $crate::rule::On::ROWS] =
                $crate::rule_set::listens(&[$(<rules::$module::$rule as $crate::rule::Rule>::ON),*]);

            #[inline]
            pub fn build(place: u16, options: &$crate::options::Options) -> Option<Rules> {
                $(if place == Place::$module as u16 {
                    return Some(Rules::$module($crate::rule::Rule::new(options)));
                })*
                None
            }

            #[inline]
            pub fn validate(place: u16, options: &$crate::options::Options) -> Result<(), Vec<u8>> {
                $(if place == Place::$module as u16 {
                    return <rules::$module::$rule as $crate::rule::Rule>::validate(options);
                })*
                Ok(())
            }

            #[inline]
            pub fn place(&self) -> u16 {
                match self {
                    $(Rules::$module(_) => Place::$module as u16,)*
                }
            }
        }

        impl $crate::runner::Starts for Rules {
            type Run<'r, 'a: 'r> = Runs<'r, 'a>;

            #[inline]
            fn meta(&self) -> &'static $crate::rule::Meta {
                match self {
                    $(Rules::$module(_) => &<rules::$module::$rule as $crate::rule::Rule>::META,)*
                }
            }

            #[inline]
            fn start<'r, 'a: 'r>(
                &'r self,
                start: $crate::runner::Start<'a>,
            ) -> Option<Runs<'r, 'a>> {
                match self {
                    $(Rules::$module(rule) => $crate::runner::start(rule, start).map(Runs::$module),)*
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

/// Joins the rules of several crates, each of which has a [`rules!`](crate::rules), to a [`RuleSet`]:
/// `rule_sets! { pub enum Rules / Runs { eslint: bun_lint_eslint, typescript: bun_lint_typescript, } }`.
#[macro_export]
macro_rules! rule_sets {
    ($visibility:vis enum $rules:ident / $runs:ident { $($name:ident: $from:ident,)* }) => {
        /// An instance of a rule.
        #[allow(non_camel_case_types, clippy::large_enum_variant)]
        $visibility enum $rules {
            $($name($from::Rules),)*
        }

        /// A rule at work on a file.
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
                $(if let Some(place) = (rule as usize).checked_sub(Crate::$name.offset())
                    && place < $from::Rules::COUNT
                {
                    return $from::Rules::build(place as u16, options).map($rules::$name);
                })*
                None
            }

            #[inline]
            fn validate(rule: u16, options: &$crate::options::Options) -> Result<(), Vec<u8>> {
                $(if let Some(place) = (rule as usize).checked_sub(Crate::$name.offset())
                    && place < $from::Rules::COUNT
                {
                    return $from::Rules::validate(place as u16, options);
                })*
                Ok(())
            }

            #[inline]
            fn number(&self) -> u16 {
                match self {
                    $($rules::$name(rule) => Crate::$name.offset() as u16 + rule.place(),)*
                }
            }
        }

        impl $crate::runner::Starts for $rules {
            type Run<'r, 'a: 'r> = $runs<'r, 'a>;

            #[inline]
            fn meta(&self) -> &'static $crate::rule::Meta {
                match self {
                    $($rules::$name(rule) => $crate::runner::Starts::meta(rule),)*
                }
            }

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
