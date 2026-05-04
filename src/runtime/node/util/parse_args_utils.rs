use bun_jsc::JSValue;
use bun_str::String;

#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum OptionValueType {
    #[default]
    Boolean,
    String,
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

    // TODO(port): bare JSValue in a struct field — Zig relies on the options slice
    // living on the stack during parseArgs so the conservative GC scan keeps it alive.
    // Verify in Phase B that the Rust caller keeps this on-stack (no Vec<OptionDefinition>
    // on the heap) or switch to bun_jsc::Strong.
    pub default_value: Option<JSValue>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
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
        if arg.has_prefix(b"-") {
            return if arg.has_prefix(b"--") {
                TokenSubtype::OptionTerminator
            } else {
                TokenSubtype::LoneShortOption
            };
        }
    } else if len > 2 {
        if arg.has_prefix(b"--") {
            return if arg.index_of_ascii_char(b'=').unwrap_or(0) >= 3 {
                TokenSubtype::LongOptionAndValue
            } else {
                TokenSubtype::LoneLongOption
            };
        } else if arg.has_prefix(b"-") {
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
    value.length() > 1 && value.has_prefix(b"-")
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
pub fn find_option_by_short_name(short_name: &String, options: &[OptionDefinition]) -> Option<usize> {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/util/parse_args_utils.zig (92 lines)
//   confidence: high
//   todos:      1
//   notes:      bun_str::String method names (has_prefix/index_of_ascii_char/substring_with_len/eql) assumed; default_value JSValue field needs GC-safety review.
// ──────────────────────────────────────────────────────────────────────────
