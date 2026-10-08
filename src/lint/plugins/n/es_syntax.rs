//! Which features of ECMAScript a range of versions of Node.js lacks.

pub(crate) use super::es_syntax_data::FEATURES;
use super::es_syntax_data::{
    REGEXP_D_FLAG, REGEXP_LOOKBEHIND_ASSERTIONS, REGEXP_NAMED_CAPTURE_GROUPS, REGEXP_S_FLAG, REGEXP_U_FLAG,
    REGEXP_UNICODE_PROPERTY_ESCAPES, REGEXP_UNICODE_PROPERTY_ESCAPES_2019, REGEXP_UNICODE_PROPERTY_ESCAPES_2020,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2021, REGEXP_UNICODE_PROPERTY_ESCAPES_2022, REGEXP_UNICODE_PROPERTY_ESCAPES_2023, REGEXP_V_FLAG,
    REGEXP_Y_FLAG,
};
use super::semver::Range;
use bun_lint::utils::eslint_utils::TraceMap;

/// A rule of eslint-plugin-es-x.
pub(crate) struct Feature {
    /// The name of the rule without `no-`.
    pub(crate) name: &'static str,
    /// What the option `ignores` can call it.
    pub(crate) ignore_names: &'static [&'static str],
    /// The versions of Node.js that have it. `<0`: none.
    pub(crate) supported: &'static str,
    /// The versions that have it outside strict mode too, if these are fewer.
    pub(crate) strict_mode: Option<&'static str>,
    /// The global variables and their properties that are the feature.
    pub(crate) globals: TraceMap<'static, ()>,
    /// The methods that are the feature, by class.
    pub(crate) prototype: &'static [(&'static str, &'static [&'static str])],
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
const FLAGS: [usize; 5] = [REGEXP_D_FLAG, REGEXP_S_FLAG, REGEXP_U_FLAG, REGEXP_V_FLAG, REGEXP_Y_FLAG];

/// The features that are reported.
pub(crate) struct Active {
    pub(crate) version: Range,
    /// A bit for each of [`FEATURES`].
    bits: [u64; FEATURES.len().div_ceil(64)],
    /// A method, the feature that it is, and the class that has it. Those of a feature follow each other.
    pub(crate) methods: Vec<(&'static str, usize, &'static str)>,
}

impl Active {
    pub(crate) fn new(version: Range, ignores: &[Box<[u8]>]) -> Active {
        let mut active = Active {
            version,
            bits: [0; FEATURES.len().div_ceil(64)],
            methods: Vec::new(),
        };
        for (index, feature) in FEATURES.iter().enumerate() {
            let is_ignored = feature.ignore_names.iter().any(|name| ignores.iter().any(|it| **it == *name.as_bytes()));
            let everywhere = Range::parse(feature.strict_mode.unwrap_or(feature.supported).as_bytes());
            if is_ignored || everywhere.is_some_and(|it| active.version.is_subset_of(&it)) {
                continue;
            }
            active.bits[index / 64] |= 1 << (index % 64);
            for (class, methods) in feature.prototype {
                active.methods.extend(methods.iter().map(|method| (*method, index, *class)));
            }
        }
        active
    }

    #[inline]
    pub(crate) fn has(&self, feature: usize) -> bool {
        self.bits.get(feature / 64).is_some_and(|word| word & (1 << (feature % 64)) != 0)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = usize> + '_ {
        (0..FEATURES.len()).filter(|&it| self.has(it))
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
