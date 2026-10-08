//! Which features of ECMAScript a range of versions of Node.js lacks.

pub(crate) use super::es_syntax_data::FEATURES;
use super::es_syntax_data::{
    REGEXP_D_FLAG, REGEXP_LOOKBEHIND_ASSERTIONS, REGEXP_NAMED_CAPTURE_GROUPS, REGEXP_S_FLAG,
    REGEXP_U_FLAG, REGEXP_UNICODE_PROPERTY_ESCAPES, REGEXP_UNICODE_PROPERTY_ESCAPES_2019,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2020, REGEXP_UNICODE_PROPERTY_ESCAPES_2021,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2022, REGEXP_UNICODE_PROPERTY_ESCAPES_2023, REGEXP_V_FLAG,
    REGEXP_Y_FLAG,
};
use super::semver::Range;
use bun_lint::ast::File;
use bun_lint::source::mention_bit;
use bun_lint::utils::eslint_utils::TraceMap;

/// A rule of eslint-plugin-es-x.
pub(crate) struct Feature {
    /// The name of the rule without `no-`.
    pub(crate) name: &'static str,
    /// What the option `ignores` can call it.
    pub(crate) ignore_names: &'static [&'static str],
    /// The versions of Node.js that have it, if any has.
    pub(crate) supported: Option<&'static str>,
    /// The versions that have it outside strict mode too, if these are fewer.
    pub(crate) strict_mode: Option<&'static str>,
    /// The global variables and their properties that are the feature.
    pub(crate) globals: TraceMap<'static, ()>,
    /// The methods that are the feature, by class.
    pub(crate) prototype: &'static [(&'static str, &'static [&'static str])],
}

impl Feature {
    /// `supported` as a range.
    pub(crate) fn supported_range(&self) -> &'static str {
        self.supported.unwrap_or("<0")
    }
}

const PATTERNS: [usize; 8] = [
    REGEXP_LOOKBEHIND_ASSERTIONS,
    REGEXP_NAMED_CAPTURE_GROUPS,
    REGEXP_UNICODE_PROPERTY_ESCAPES,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2019,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2020,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2021,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2022,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2023,
];
const FLAGS: [usize; 5] = [
    REGEXP_D_FLAG,
    REGEXP_S_FLAG,
    REGEXP_U_FLAG,
    REGEXP_V_FLAG,
    REGEXP_Y_FLAG,
];

/// The features that are reported.
pub(crate) struct Active {
    pub(crate) version: Range,
    /// A bit for each of [`FEATURES`].
    bits: [u64; FEATURES.len().div_ceil(64)],
    /// A method, the feature that it is, and the class that has it. Those of a feature follow each other.
    pub(crate) methods: Vec<(&'static str, usize, &'static str)>,
    /// The features that are global variables or properties of them. For each variable [`mention_bit`] of its name and of the
    /// names of its properties.
    globals: Vec<(usize, Vec<(u32, Vec<u32>)>)>,
}

impl Active {
    pub(crate) fn new(version: Range, ignores: &[Box<[u8]>]) -> Active {
        let mut active = Active {
            version,
            bits: [0; FEATURES.len().div_ceil(64)],
            methods: Vec::new(),
            globals: Vec::new(),
        };
        for (index, feature) in FEATURES.iter().enumerate() {
            let is_ignored = feature
                .ignore_names
                .iter()
                .any(|name| ignores.iter().any(|it| **it == *name.as_bytes()));
            let everywhere = feature
                .strict_mode
                .unwrap_or_else(|| feature.supported_range());
            let everywhere = Range::parse(everywhere.as_bytes());
            if is_ignored || everywhere.is_some_and(|it| active.version.is_subset_of(&it)) {
                continue;
            }
            active.bits[index / 64] |= 1 << (index % 64);
            if !feature.globals.members.is_empty() {
                let bit = |name: &str| mention_bit(name.as_bytes());
                let variables = feature
                    .globals
                    .members
                    .iter()
                    .map(|it| (bit(it.0), it.1.members.iter().map(|it| bit(it.0)).collect()));
                active.globals.push((index, variables.collect()));
            }
            for (class, methods) in feature.prototype {
                active
                    .methods
                    .extend(methods.iter().map(|method| (*method, index, *class)));
            }
        }
        active
    }

    #[inline]
    pub(crate) fn has(&self, feature: usize) -> bool {
        self.bits
            .get(feature / 64)
            .is_some_and(|word| word & (1 << (feature % 64)) != 0)
    }

    /// The features that are global variables or properties of them which the file mentions.
    pub(crate) fn globals_in<'s>(&'s self, file: &'s File) -> impl Iterator<Item = usize> + 's {
        let is_mentioned = |it: &(u32, Vec<u32>)| {
            file.mentions_bit(it.0)
                && (it.1.is_empty() || it.1.iter().any(|it| file.mentions_bit(*it)))
        };
        self.globals
            .iter()
            .filter(move |it| it.1.iter().any(is_mentioned))
            .map(|it| it.0)
    }

    /// One that is about the pattern of a regular expression.
    pub(crate) fn has_regexp_pattern(&self) -> bool {
        PATTERNS.iter().any(|&it| self.has(it))
    }

    /// One that is about regular expressions.
    pub(crate) fn has_regexp(&self) -> bool {
        self.has_regexp_pattern() || FLAGS.iter().any(|&it| self.has(it))
    }
}
