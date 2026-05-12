use bun_core::String;
use bun_jsc::JSValue;

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum OptionValueType {
    #[default]
    Boolean,
    String,
}

impl From<OptionValueType> for &'static str {
    #[inline]
    fn from(v: OptionValueType) -> Self {
        match v {
            OptionValueType::Boolean => "boolean",
            OptionValueType::String => "string",
        }
    }
}

impl super::validators::StringEnum for OptionValueType {
    const VALUES_INFO: &'static str = "boolean|string";
    fn from_bun_string(s: &String) -> Option<Self> {
        if s.eql_comptime(b"boolean") {
            Some(Self::Boolean)
        } else if s.eql_comptime(b"string") {
            Some(Self::String)
        } else {
            None
        }
    }
}

/// Metadata of an option known to the args parser,
/// i.e. the values passed to `parseArgs(..., { options: <values> })`
pub struct OptionDefinition {
    // e.g. "abc" for --abc
    pub long_name: String,

    /// e.g. "a" for -a
    /// if len is 0, it has no short name
    pub short_name: String,

    pub r#type: OptionValueType,

    pub multiple: bool,

    /// Bare `JSValue` is safe here: the Zig spec keeps the options slice on the
    /// stack for the lifetime of `parseArgs`, so JSC's conservative stack scan
    /// roots these values. The Rust caller (`parse_args.rs`) must mirror that
    /// invariant — keep the backing storage stack-reachable or otherwise rooted.
    pub default_value: Option<JSValue>,
}

impl Default for OptionDefinition {
    fn default() -> Self {
        Self {
            long_name: String::empty(),
            short_name: String::empty(),
            r#type: OptionValueType::Boolean,
            multiple: false,
            default_value: None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum TokenSubtype {
    /// '--'
    OptionTerminator,
    /// e.g. '-f'
    LoneShortOption,
    /// e.g. '-fXzy'
    ShortOptionGroup,
    /// e.g. '-fFILE'
    ShortOptionAndValue,
    /// e.g. '--foo'
    LoneLongOption,
    /// e.g. '--foo=barconst'
    LongOptionAndValue,

    Positional,
}

#[inline]
pub fn classify_token(arg: &String, options: &[OptionDefinition]) -> TokenSubtype {
    let len = arg.length();

    if len == 2 {
        if arg.has_prefix_comptime(b"-") {
            return if arg.has_prefix_comptime(b"--") {
                TokenSubtype::OptionTerminator
            } else {
                TokenSubtype::LoneShortOption
            };
        }
    } else if len > 2 {
        if arg.has_prefix_comptime(b"--") {
            return if arg.index_of_ascii_char(b'=').unwrap_or(0) >= 3 {
                TokenSubtype::LongOptionAndValue
            } else {
                TokenSubtype::LoneLongOption
            };
        } else if arg.has_prefix_comptime(b"-") {
            let first_char = arg.substring_with_len(1, 2);
            let option_idx = find_option_by_short_name(&first_char, options);
            if let Some(i) = option_idx {
                return if options[i].r#type == OptionValueType::String {
                    TokenSubtype::ShortOptionAndValue
                } else {
                    TokenSubtype::ShortOptionGroup
                };
            } else {
                return TokenSubtype::ShortOptionGroup;
            }
        }
    }

    TokenSubtype::Positional
}

/// Detect whether there is possible confusion and user may have omitted
/// the option argument, like `--port --verbose` when `port` of type:string.
/// In strict mode we throw errors if value is option-like.
pub fn is_option_like_value(value: &String) -> bool {
    value.length() > 1 && value.has_prefix_comptime(b"-")
}

/// Find the long option associated with a short option. Looks for a configured
/// `short` and returns the short option itself if a long option is not found.
/// Example:
/// ```zig
/// findOptionByShortName('a', {}) // returns 'a'
/// findOptionByShortName('b', {
///   options: { bar: { short: 'b' } }
/// }) // returns "bar"
/// ```
pub fn find_option_by_short_name(
    short_name: &String,
    options: &[OptionDefinition],
) -> Option<usize> {
    let mut long_option_index: Option<usize> = None;
    for (i, option) in options.iter().enumerate() {
        if short_name.eql(&option.short_name) {
            return Some(i);
        }
        if option.long_name.length() == 1 && short_name.eql(&option.long_name) {
            long_option_index = Some(i);
        }
    }
    long_option_index
}

// ported from: src/runtime/node/util/parse_args_utils.zig
