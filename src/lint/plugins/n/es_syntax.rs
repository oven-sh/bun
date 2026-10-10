//! Which features of ECMAScript a range of versions of Node.js lacks.

pub(crate) use super::es_syntax_data::FEATURES;
use super::es_syntax_data::{
    EsFeature, REGEXP_D_FLAG, REGEXP_LOOKBEHIND_ASSERTIONS, REGEXP_NAMED_CAPTURE_GROUPS,
    REGEXP_S_FLAG, REGEXP_U_FLAG, REGEXP_UNICODE_PROPERTY_ESCAPES,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2019, REGEXP_UNICODE_PROPERTY_ESCAPES_2020,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2021, REGEXP_UNICODE_PROPERTY_ESCAPES_2022,
    REGEXP_UNICODE_PROPERTY_ESCAPES_2023, REGEXP_V_FLAG, REGEXP_Y_FLAG,
};
use super::semver::Range;
use super::table::{Member, Part};
use bun_lint::ast::File;
use bun_lint::source::mention_bit;

/// A rule of eslint-plugin-es-x. All are parts of the table [`EsFeature`].
pub(crate) struct Feature {
    name: Part,
    supported: Part,
    strict_mode: Part,
    aliases: Part,
    globals: Part,
    prototype: Part,
}

impl Feature {
    pub(crate) const fn new(
        [name, supported, strict_mode]: [Part; 3],
        [aliases, globals, prototype]: [Part; 3],
    ) -> Feature {
        Feature {
            name,
            supported,
            strict_mode,
            aliases,
            globals,
            prototype,
        }
    }

    /// The name of the rule without `no-`.
    pub(crate) fn name(&self) -> &'static str {
        self.name.text::<EsFeature>()
    }

    /// The versions of Node.js that have it, if any has.
    pub(crate) fn supported(&self) -> Option<&'static str> {
        Some(self.supported.text::<EsFeature>()).filter(|it| !it.is_empty())
    }

    /// `supported` as a range.
    pub(crate) fn supported_range(&self) -> &'static str {
        self.supported().unwrap_or("<0")
    }

    /// The versions that have it outside strict mode too, if these are fewer.
    pub(crate) fn strict_mode(&self) -> Option<&'static str> {
        Some(self.strict_mode.text::<EsFeature>()).filter(|it| !it.is_empty())
    }

    /// The global variables and their properties that are the feature.
    pub(crate) fn globals(&self) -> &'static [Member<EsFeature>] {
        self.globals.members::<EsFeature>()
    }

    /// The classes, with the methods that are the feature as their members.
    fn prototype(&self) -> &'static [Member<EsFeature>] {
        self.prototype.members::<EsFeature>()
    }

    /// Whether the option `ignores` can call it `ignored`: by the name of the rule, by its own name, by that in camel
    /// case or by an alias.
    fn is_called(&self, ignored: &[u8]) -> bool {
        let name = self.name().as_bytes();
        let mut aliases = self.aliases.members::<EsFeature>().iter();
        ignored == name
            || ignored.strip_prefix(b"no-") == Some(name)
            || ignored == camel_case(name)
            || aliases.any(|it| it.name().as_bytes() == ignored)
    }
}

/// `name.replace(/-(\w)/g, (_, first) => first.toUpperCase())`
fn camel_case(name: &[u8]) -> Vec<u8> {
    let mut camel = Vec::with_capacity(name.len());
    let mut rest = name.iter().copied().peekable();
    while let Some(byte) = rest.next() {
        match rest.next_if(|it| byte == b'-' && bun_core::strings::is_regexp_word_byte(*it)) {
            Some(first) => camel.push(first.to_ascii_uppercase()),
            None => camel.push(byte),
        }
    }
    camel
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
    /// Each name of a method once, with its [`mention_bit`].
    pub(crate) method_names: Vec<(&'static str, u32)>,
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
            method_names: Vec::new(),
            globals: Vec::new(),
        };
        for (index, feature) in FEATURES.iter().enumerate() {
            let is_ignored = ignores.iter().any(|it| feature.is_called(it));
            let everywhere = feature
                .strict_mode()
                .unwrap_or_else(|| feature.supported_range());
            let everywhere = Range::parse(everywhere.as_bytes());
            if is_ignored || everywhere.is_some_and(|it| active.version.is_subset_of(&it)) {
                continue;
            }
            active.bits[index / 64] |= 1 << (index % 64);
            if !feature.globals().is_empty() {
                let bit = |it: &Member<EsFeature>| mention_bit(it.name().as_bytes());
                let variables = feature
                    .globals()
                    .iter()
                    .map(|it| (bit(it), it.members().iter().map(bit).collect()));
                active.globals.push((index, variables.collect()));
            }
            for class in feature.prototype() {
                let methods = class.members().iter();
                active
                    .methods
                    .extend(methods.map(|method| (method.name(), index, class.name())));
            }
        }
        for &(method, ..) in &active.methods {
            if !active.method_names.iter().any(|it| it.0 == method) {
                let bit = mention_bit(method.as_bytes());
                active.method_names.push((method, bit));
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

    pub(crate) fn has_any(&self) -> bool {
        self.bits.iter().any(|it| *it != 0)
    }

    /// The feature whose rule has the listeners that report `feature`: the rules about patterns share those of the first.
    pub(crate) fn listens_for(&self, feature: usize) -> usize {
        if !PATTERNS.contains(&feature) {
            return feature;
        }
        let patterns = PATTERNS.iter().copied().filter(|&it| self.has(it));
        patterns.min().unwrap_or(feature)
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
