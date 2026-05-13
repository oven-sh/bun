use core::fmt;

use bun_core::{OwnedString, String, ZigString};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

use super::parse_args_utils::{
    OptionDefinition, OptionValueType, TokenSubtype, classify_token, find_option_by_short_name,
    is_option_like_value,
};
use super::validators;

bun_output::declare_scope!(parseArgs, hidden);

/// Represents a slice of a JSValue array
#[derive(Copy, Clone)]
struct ArgsSlice {
    array: JSValue,
    start: u32,
    end: u32,
}

impl ArgsSlice {
    #[inline]
    pub fn get(&self, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        self.array.get_index(global, self.start + i)
    }
}

/// Helper ref to either a JSValue or a String,
/// used in order to avoid creating unneeded JSValue as much as possible
#[derive(Copy, Clone)]
enum ValueRef {
    Jsvalue(JSValue),
    Bunstr(String),
}

impl ValueRef {
    pub fn as_bun_string(&self, global: &JSGlobalObject) -> JsResult<String> {
        match self {
            ValueRef::Jsvalue(str) => str.to_bun_string(global),
            ValueRef::Bunstr(str) => Ok(*str),
        }
    }

    pub fn as_js_value(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            ValueRef::Jsvalue(str) => Ok(*str),
            ValueRef::Bunstr(str) => str.to_js(global),
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, strum::IntoStaticStr)]
enum TokenKind {
    #[strum(serialize = "positional")]
    Positional,
    #[strum(serialize = "option")]
    Option,
    #[strum(serialize = "option-terminator")]
    OptionTerminator,
}

impl TokenKind {
    const COUNT: usize = 3;
}

enum Token {
    Positional { index: u32, value: ValueRef },
    Option(OptionToken),
    OptionTerminator { index: u32 },
}

impl Token {
    fn kind(&self) -> TokenKind {
        match self {
            Token::Positional { .. } => TokenKind::Positional,
            Token::Option(_) => TokenKind::Option,
            Token::OptionTerminator { .. } => TokenKind::OptionTerminator,
        }
    }
}

#[derive(Copy, Clone)]
enum OptionParseType {
    LoneShortOption,
    ShortOptionAndValue,
    LoneLongOption,
    LongOptionAndValue,
}

#[derive(Copy, Clone)]
struct OptionToken {
    index: u32,
    name: ValueRef,
    parse_type: OptionParseType,
    value: ValueRef,
    inline_value: bool,
    optgroup_idx: Option<u32>,
    option_idx: Option<usize>,
    negative: bool,

    /// The full raw arg string (e.g. "--arg=1").
    /// If the value existed as-is in the input "args" list, it is stored as so, otherwise is null
    raw: ValueRef,
}

struct RawNameFormatter {
    token: OptionToken,
    raw: String,
}

impl fmt::Display for RawNameFormatter {
    /// Formats the raw name of the arg (includes any dashes and excludes inline values)
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let token = &self.token;
        let raw = self.raw;
        if let Some(optgroup_idx) = token.optgroup_idx {
            let i = optgroup_idx as usize;
            raw.substring_with_len(i, i + 1).fmt(f)
        } else {
            match token.parse_type {
                OptionParseType::LoneShortOption | OptionParseType::LoneLongOption => raw.fmt(f),
                OptionParseType::ShortOptionAndValue => {
                    let substr = raw.substring_with_len(0, 2);
                    substr.fmt(f)
                }
                OptionParseType::LongOptionAndValue => {
                    let equal_index = raw.index_of_ascii_char(b'=').unwrap();
                    let substr = raw.substring_with_len(0, equal_index);
                    substr.fmt(f)
                }
            }
        }
    }
}

impl OptionToken {
    /// Returns the raw name of the arg (includes any dashes and excludes inline values), as a JSValue
    fn make_raw_name_js_value(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(optgroup_idx) = self.optgroup_idx {
            let raw = self.raw.as_bun_string(global)?;
            let i = optgroup_idx as usize;
            let mut buf = [0u8; 8];
            let str = {
                use std::io::Write;
                let mut cursor: &mut [u8] = &mut buf[..];
                write!(cursor, "-{}", raw.substring_with_len(i, i + 1)).expect("unreachable");
                let written = 8 - cursor.len();
                &buf[..written]
            };
            String::borrow_utf8(str).to_js(global)
        } else {
            match self.parse_type {
                OptionParseType::LoneShortOption | OptionParseType::LoneLongOption => {
                    self.raw.as_js_value(global)
                }
                OptionParseType::ShortOptionAndValue => {
                    let raw = self.raw.as_bun_string(global)?;
                    let substr = raw.substring_with_len(0, 2);
                    substr.to_js(global)
                }
                OptionParseType::LongOptionAndValue => {
                    let raw = self.raw.as_bun_string(global)?;
                    let equal_index = raw.index_of_ascii_char(b'=').unwrap();
                    let substr = raw.substring_with_len(0, equal_index);
                    substr.to_js(global)
                }
            }
        }
    }
}

pub fn find_option_by_long_name(long_name: String, options: &[OptionDefinition]) -> Option<usize> {
    for (i, option) in options.iter().enumerate() {
        if long_name.eql(&option.long_name) {
            return Some(i);
        }
    }
    None
}

/// Gets the default args from the process argv
fn get_default_args(global: &JSGlobalObject) -> JsResult<ArgsSlice> {
    // Work out where to slice process.argv for user supplied arguments

    let exec_argv = super::process::get_exec_argv(global);
    let argv = super::process::get_argv(global);
    if argv.is_array() && exec_argv.is_array() {
        let mut iter = exec_argv.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            if item.is_string() {
                let str = OwnedString::new(item.to_bun_string(global)?);
                if str.eql_comptime(b"-e")
                    || str.eql_comptime(b"--eval")
                    || str.eql_comptime(b"-p")
                    || str.eql_comptime(b"--print")
                {
                    return Ok(ArgsSlice {
                        array: argv,
                        start: 1,
                        end: u32::try_from(argv.get_length(global)?).expect("int cast"),
                    });
                }
            }
        }
        return Ok(ArgsSlice {
            array: argv,
            start: 2,
            end: u32::try_from(argv.get_length(global)?).expect("int cast"),
        });
    }

    Ok(ArgsSlice {
        array: JSValue::UNDEFINED,
        start: 0,
        end: 0,
    })
}

/// In strict mode, throw for possible usage errors like "--foo --bar" where foo was defined as a string-valued arg
fn check_option_like_value(global: &JSGlobalObject, token: OptionToken) -> JsResult<()> {
    if !token.inline_value && is_option_like_value(&token.value.as_bun_string(global)?) {
        let raw = token.raw.as_bun_string(global)?;
        let raw_name = RawNameFormatter { token, raw };

        // Only show short example if user used short option.
        let err: JSValue;
        if raw.has_prefix_comptime(b"--") {
            err = global.to_type_error(
                bun_jsc::ErrorCode::PARSE_ARGS_INVALID_OPTION_VALUE,
                format_args!(
                    "Option '{raw_name}' argument is ambiguous.\nDid you forget to specify the option argument for '{raw_name}'?\nTo specify an option argument starting with a dash use '{raw_name}=-XYZ'.",
                ),
            );
        } else {
            let token_name = token.name.as_bun_string(global)?;
            err = global.to_type_error(
                bun_jsc::ErrorCode::PARSE_ARGS_INVALID_OPTION_VALUE,
                format_args!(
                    "Option '{raw_name}' argument is ambiguous.\nDid you forget to specify the option argument for '{raw_name}'?\nTo specify an option argument starting with a dash use '--{token_name}=-XYZ' or '{raw_name}-XYZ'.",
                ),
            );
        }
        return Err(global.throw_value(err));
    }
    Ok(())
}

/// In strict mode, throw for usage errors.
fn check_option_usage(
    global: &JSGlobalObject,
    options: &[OptionDefinition],
    allow_positionals: bool,
    token: OptionToken,
) -> JsResult<()> {
    if let Some(option_idx) = token.option_idx {
        let option = &options[option_idx];
        match option.r#type {
            OptionValueType::String => {
                if matches!(token.value, ValueRef::Jsvalue(v) if !v.is_string()) {
                    if token.negative {
                        // the option was found earlier because we trimmed 'no-' from the name, so we throw
                        // the expected unknown option error.
                        let raw_name = RawNameFormatter {
                            token,
                            raw: token.raw.as_bun_string(global)?,
                        };
                        let err = global.to_type_error(
                            bun_jsc::ErrorCode::PARSE_ARGS_UNKNOWN_OPTION,
                            format_args!("Unknown option '{raw_name}'"),
                        );
                        return Err(global.throw_value(err));
                    }
                    let err = global.to_type_error(
                        bun_jsc::ErrorCode::PARSE_ARGS_INVALID_OPTION_VALUE,
                        format_args!(
                            "Option '{}{}{}--{} <value>' argument missing",
                            if !option.short_name.is_empty() {
                                "-"
                            } else {
                                ""
                            },
                            option.short_name,
                            if !option.short_name.is_empty() {
                                ", "
                            } else {
                                ""
                            },
                            token.name.as_bun_string(global)?,
                        ),
                    );
                    return Err(global.throw_value(err));
                }
            }
            OptionValueType::Boolean => {
                if !matches!(token.value, ValueRef::Jsvalue(v) if v.is_undefined()) {
                    let err = global.to_type_error(
                        bun_jsc::ErrorCode::PARSE_ARGS_INVALID_OPTION_VALUE,
                        format_args!(
                            "Option '{}{}{}--{}' does not take an argument",
                            if !option.short_name.is_empty() {
                                "-"
                            } else {
                                ""
                            },
                            option.short_name,
                            if !option.short_name.is_empty() {
                                ", "
                            } else {
                                ""
                            },
                            token.name.as_bun_string(global)?,
                        ),
                    );
                    return Err(global.throw_value(err));
                }
            }
        }
    } else {
        let raw_name = RawNameFormatter {
            token,
            raw: token.raw.as_bun_string(global)?,
        };

        let err = if allow_positionals {
            global.to_type_error(
                bun_jsc::ErrorCode::PARSE_ARGS_UNKNOWN_OPTION,
                format_args!(
                    "Unknown option '{raw_name}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{raw_name}\"",
                ),
            )
        } else {
            global.to_type_error(
                bun_jsc::ErrorCode::PARSE_ARGS_UNKNOWN_OPTION,
                format_args!("Unknown option '{raw_name}'"),
            )
        };
        return Err(global.throw_value(err));
    }
    Ok(())
}

/// Store the option value in `values`.
/// Parameters:
/// - `option_name`: long option name e.g. "foo"
/// - `option_value`: value from user args
/// - `options`: option configs, from `parseArgs({ options })`
/// - `values`: option values returned in `values` by parseArgs
fn store_option(
    global: &JSGlobalObject,
    option_name: ValueRef,
    option_value: ValueRef,
    option_idx: Option<usize>,
    negative: bool,
    options: &[OptionDefinition],
    values: JSValue,
) -> JsResult<()> {
    let key = option_name.as_bun_string(global)?;
    if key.eql_comptime(b"__proto__") {
        return Ok(());
    }

    let value = option_value.as_js_value(global)?;

    // We store based on the option value rather than option type,
    // preserving the users intent for author to deal with.
    let new_value: JSValue = if value.is_undefined() {
        JSValue::from(!negative)
    } else {
        value
    };

    let is_multiple = option_idx.map_or(false, |idx| options[idx].multiple);
    if is_multiple {
        // Always store value in array, including for boolean.
        // values[long_option] starts out not present,
        // first value is added as new array [new_value],
        // subsequent values are pushed to existing array.
        if let Some(value_list) = values.get_own(global, &key)? {
            value_list.push(global, new_value)?;
        } else {
            let value_list = JSValue::create_empty_array(global, 1)?;
            value_list.put_index(global, 0, new_value)?;
            values.put_may_be_index(global, &key, value_list)?;
        }
    } else {
        values.put_may_be_index(global, &key, new_value)?;
    }
    Ok(())
}

fn parse_option_definitions(
    global: &JSGlobalObject,
    options_obj: JSValue,
    option_definitions: &mut Vec<OptionDefinition>,
) -> JsResult<()> {
    validators::validate_object(global, options_obj, "options", Default::default())?;

    let mut iter = bun_jsc::JSPropertyIterator::init(
        global,
        // SAFETY: validateObject ensures it's an object
        options_obj.get_object().unwrap(),
        bun_jsc::JSPropertyIteratorOptions::new(false, true),
    )?;
    // `defer iter.deinit()` — Drop handles cleanup

    while let Some(long_option) = iter.next()? {
        let mut option = OptionDefinition {
            long_name: String::init(long_option),
            ..Default::default()
        };

        let obj: JSValue = iter.value;
        validators::validate_object(
            global,
            obj,
            format_args!("options.{}", option.long_name),
            Default::default(),
        )?;

        // type field is required
        let option_type: JSValue = obj
            .get_own(global, &String::static_("type"))?
            .unwrap_or(JSValue::UNDEFINED);
        option.r#type = validators::validate_string_enum::<OptionValueType>(
            global,
            option_type,
            format_args!("options.{}.type", option.long_name),
        )?;

        if let Some(short_option) = obj.get_own(global, &String::static_("short"))? {
            validators::validate_string(
                global,
                short_option,
                format_args!("options.{}.short", option.long_name),
            )?;
            let short_option_str = short_option.to_bun_string(global)?;
            if short_option_str.length() != 1 {
                let err = global.to_type_error(
                    bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "options.{}.short must be a single character",
                        option.long_name
                    ),
                );
                return Err(global.throw_value(err));
            }
            option.short_name = short_option_str;
        }

        if let Some(multiple_value) = obj.get_own(global, &String::static_("multiple"))? {
            if !multiple_value.is_undefined() {
                option.multiple = validators::validate_boolean(
                    global,
                    multiple_value,
                    format_args!("options.{}.multiple", option.long_name),
                )?;
            }
        }

        if let Some(default_value) = obj.get_own(global, &String::static_("default"))? {
            if !default_value.is_undefined() {
                match option.r#type {
                    OptionValueType::String => {
                        if option.multiple {
                            let _ = validators::validate_string_array(
                                global,
                                default_value,
                                format_args!("options.{}.default", option.long_name),
                            )?;
                        } else {
                            validators::validate_string(
                                global,
                                default_value,
                                format_args!("options.{}.default", option.long_name),
                            )?;
                        }
                    }
                    OptionValueType::Boolean => {
                        if option.multiple {
                            let _ = validators::validate_boolean_array(
                                global,
                                default_value,
                                format_args!("options.{}.default", option.long_name),
                            )?;
                        } else {
                            let _ = validators::validate_boolean(
                                global,
                                default_value,
                                format_args!("options.{}.default", option.long_name),
                            )?;
                        }
                    }
                }
                option.default_value = Some(default_value);
            }
        }

        bun_output::scoped_log!(
            parseArgs,
            "[OptionDef] \"{}\" (type={}, short={}, multiple={}, default={})",
            String::init(long_option),
            <&'static str>::from(option.r#type),
            if !option.short_name.is_empty() {
                option.short_name
            } else {
                String::static_("none")
            },
            option.multiple as u8,
            if option.default_value.is_some() {
                "set"
            } else {
                "none"
            },
        );

        option_definitions.push(option);
    }
    Ok(())
}

/// Process the args string-array and build an array identified tokens:
/// - option (along with value, if any)
/// - positional
/// - option-terminator
fn tokenize_args(
    ctx: &mut ParseArgsState,
    global: &JSGlobalObject,
    args: ArgsSlice,
    options: &[OptionDefinition],
) -> JsResult<()> {
    let num_args: u32 = args.end - args.start;
    let mut index: u32 = 0;
    while index < num_args {
        let arg_ref = ValueRef::Jsvalue(args.get(global, index)?);
        let arg = arg_ref.as_bun_string(global)?;

        let token_rawtype = classify_token(&arg, options);
        bun_output::scoped_log!(
            parseArgs,
            " [Arg #{}] {} ({})",
            index,
            <&'static str>::from(token_rawtype),
            arg
        );

        match token_rawtype {
            // Check if `arg` is an options terminator.
            // Guideline 10 in https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html
            TokenSubtype::OptionTerminator => {
                // Everything after a bare '--' is considered a positional argument.
                ctx.handle_token(Token::OptionTerminator { index })?;
                index += 1;

                while index < num_args {
                    ctx.handle_token(Token::Positional {
                        index,
                        value: ValueRef::Jsvalue(args.get(global, index)?),
                    })?;
                    index += 1;
                }
                break; // Finished processing args, leave while loop.
            }

            // isLoneShortOption
            TokenSubtype::LoneShortOption => {
                // e.g. '-f'
                let short_option = arg.substring_with_len(1, 2);
                let option_idx = find_option_by_short_name(&short_option, options);
                let option_type: OptionValueType =
                    option_idx.map_or(OptionValueType::Boolean, |idx| options[idx].r#type);
                let mut value = ValueRef::Jsvalue(JSValue::UNDEFINED);
                let mut has_inline_value = true;
                if option_type == OptionValueType::String && index + 1 < num_args {
                    // e.g. '-f', "bar"
                    value = ValueRef::Jsvalue(args.get(global, index + 1)?);
                    has_inline_value = false;
                    bun_output::scoped_log!(
                        parseArgs,
                        "   (lone_short_option consuming next token as value)"
                    );
                }
                ctx.handle_token(Token::Option(OptionToken {
                    index,
                    value,
                    inline_value: has_inline_value,
                    name: ValueRef::Bunstr(match option_idx {
                        Some(idx) => options[idx].long_name,
                        None => arg.substring_with_len(1, 2),
                    }),
                    parse_type: OptionParseType::LoneShortOption,
                    raw: arg_ref,
                    option_idx,
                    optgroup_idx: None,
                    negative: false,
                }))?;

                if !has_inline_value {
                    index += 1;
                }
            }

            // isShortOptionGroup
            TokenSubtype::ShortOptionGroup => {
                // Expand -fXzy to -f -X -z -y
                let original_arg_idx = index;
                let arg_len = arg.length();
                for idx_in_optgroup in 1..arg_len {
                    let short_option = arg.substring_with_len(idx_in_optgroup, idx_in_optgroup + 1);
                    let option_idx = find_option_by_short_name(&short_option, options);
                    let option_type: OptionValueType =
                        option_idx.map_or(OptionValueType::Boolean, |idx| options[idx].r#type);
                    if option_type != OptionValueType::String || idx_in_optgroup == arg_len - 1 {
                        // Boolean option, or last short in group. Well formed.

                        // Immediately process as a lone_short_option (e.g. from input -abc, process -a -b -c)
                        let mut value = ValueRef::Jsvalue(JSValue::UNDEFINED);
                        let mut has_inline_value = true;
                        if option_type == OptionValueType::String && index + 1 < num_args {
                            // e.g. '-f', "bar"
                            value = ValueRef::Jsvalue(args.get(global, index + 1)?);
                            has_inline_value = false;
                            bun_output::scoped_log!(
                                parseArgs,
                                "   (short_option_group short option consuming next token as value)"
                            );
                        }
                        ctx.handle_token(Token::Option(OptionToken {
                            index: original_arg_idx,
                            optgroup_idx: Some(u32::try_from(idx_in_optgroup).expect("int cast")),
                            value,
                            inline_value: has_inline_value,
                            name: ValueRef::Bunstr(match option_idx {
                                Some(i) => options[i].long_name,
                                None => short_option,
                            }),
                            parse_type: OptionParseType::LoneShortOption,
                            raw: arg_ref,
                            option_idx,
                            negative: false,
                        }))?;

                        if !has_inline_value {
                            index += 1;
                        }
                    } else {
                        // String option in middle. Yuck.
                        // Expand -abfFILE to -a -b -fFILE

                        // Immediately process as a short_option_and_value
                        ctx.handle_token(Token::Option(OptionToken {
                            index: original_arg_idx,
                            optgroup_idx: Some(u32::try_from(idx_in_optgroup).expect("int cast")),
                            value: ValueRef::Bunstr(arg.substring(idx_in_optgroup + 1)),
                            inline_value: true,
                            name: ValueRef::Bunstr(match option_idx {
                                Some(i) => options[i].long_name,
                                None => short_option,
                            }),
                            parse_type: OptionParseType::ShortOptionAndValue,
                            raw: arg_ref,
                            option_idx,
                            negative: false,
                        }))?;

                        break; // finished short group
                    }
                }
            }

            TokenSubtype::ShortOptionAndValue => {
                // e.g. -fFILE
                let short_option = arg.substring_with_len(1, 2);
                let option_idx = find_option_by_short_name(&short_option, options);
                let value = arg.substring(2);

                ctx.handle_token(Token::Option(OptionToken {
                    index,
                    value: ValueRef::Bunstr(value),
                    inline_value: true,
                    name: ValueRef::Bunstr(match option_idx {
                        Some(idx) => options[idx].long_name,
                        None => arg.substring_with_len(1, 2),
                    }),
                    parse_type: OptionParseType::ShortOptionAndValue,
                    raw: ValueRef::Bunstr(arg.substring_with_len(0, 2)),
                    option_idx,
                    optgroup_idx: None,
                    negative: false,
                }))?;
            }

            TokenSubtype::LoneLongOption => {
                // e.g. '--foo'
                let mut long_option = arg.substring(2);

                let negative = if ctx.allow_negative && long_option.has_prefix_comptime(b"no-") {
                    long_option = long_option.substring(3);
                    true
                } else {
                    false
                };

                let option_idx = find_option_by_long_name(long_option, options);
                let option_type: OptionValueType =
                    option_idx.map_or(OptionValueType::Boolean, |idx| options[idx].r#type);

                let mut value: Option<JSValue> = None;
                if option_type == OptionValueType::String && index + 1 < num_args && !negative {
                    // e.g. '--foo', "bar"
                    value = Some(args.get(global, index + 1)?);
                    bun_output::scoped_log!(parseArgs, "  (consuming next as value)");
                }

                ctx.handle_token(Token::Option(OptionToken {
                    index,
                    value: ValueRef::Jsvalue(value.unwrap_or(JSValue::UNDEFINED)),
                    inline_value: value.is_none(),
                    name: ValueRef::Bunstr(long_option),
                    parse_type: OptionParseType::LoneLongOption,
                    raw: arg_ref,
                    option_idx,
                    optgroup_idx: None,
                    negative,
                }))?;

                if value.is_some() {
                    index += 1;
                }
            }

            TokenSubtype::LongOptionAndValue => {
                // e.g. --foo=barconst
                let equal_index = arg.index_of_ascii_char(b'=');
                let long_option = arg.substring_with_len(2, equal_index.unwrap());
                let value = arg.substring(equal_index.unwrap() + 1);

                ctx.handle_token(Token::Option(OptionToken {
                    index,
                    value: ValueRef::Bunstr(value),
                    inline_value: true,
                    name: ValueRef::Bunstr(long_option),
                    parse_type: OptionParseType::LongOptionAndValue,
                    raw: arg_ref,
                    option_idx: find_option_by_long_name(long_option, options),
                    optgroup_idx: None,
                    negative: false,
                }))?;
            }

            TokenSubtype::Positional => {
                ctx.handle_token(Token::Positional {
                    index,
                    value: arg_ref,
                })?;
            }
        }

        index += 1;
    }
    Ok(())
}

struct ParseArgsState<'a> {
    global: &'a JSGlobalObject,

    option_defs: &'a [OptionDefinition],
    allow_positionals: bool,
    strict: bool,
    allow_negative: bool,

    // Output
    values: JSValue,
    positionals: JSValue,
    tokens: JSValue,

    /// To reuse JSValue for the "kind" field in the output tokens array ("positional", "option", "option-terminator")
    kinds_jsvalues: [Option<JSValue>; TokenKind::COUNT],
}

impl<'a> ParseArgsState<'a> {
    pub fn handle_token(&mut self, token_generic: Token) -> JsResult<()> {
        let global = self.global;

        match &token_generic {
            Token::Option(token) => {
                if self.strict {
                    check_option_usage(global, self.option_defs, self.allow_positionals, *token)?;
                    check_option_like_value(global, *token)?;
                }
                store_option(
                    global,
                    token.name,
                    token.value,
                    token.option_idx,
                    token.negative,
                    self.option_defs,
                    self.values,
                )?;
            }
            Token::Positional { value, .. } => {
                if !self.allow_positionals {
                    let err = global.to_type_error(
                        bun_jsc::ErrorCode::PARSE_ARGS_UNEXPECTED_POSITIONAL,
                        format_args!(
                            "Unexpected argument '{}'. This command does not take positional arguments",
                            value.as_bun_string(global)?,
                        ),
                    );
                    return Err(global.throw_value(err));
                }
                let value = value.as_js_value(global)?;
                self.positionals.push(global, value)?;
            }
            Token::OptionTerminator { .. } => {}
        }

        // Append to the parseArgs result "tokens" field
        // This field is opt-in, and people usually don't ask for it, so only create the js values if they are asked for
        if !self.tokens.is_undefined() {
            let num_properties: usize = match &token_generic {
                Token::Option(token) => {
                    if matches!(token.value, ValueRef::Jsvalue(v) if v.is_undefined()) {
                        4
                    } else {
                        6
                    }
                }
                Token::Positional { .. } => 3,
                Token::OptionTerminator { .. } => 2,
            };

            // reuse JSValue for the kind names: "positional", "option", "option-terminator"
            let kind = token_generic.kind();
            let kind_idx = kind as usize;
            let kind_jsvalue = match self.kinds_jsvalues[kind_idx] {
                Some(v) => v,
                None => {
                    let val = String::static_(<&'static str>::from(kind)).to_js(global)?;
                    self.kinds_jsvalues[kind_idx] = Some(val);
                    val
                }
            };

            let obj = JSValue::create_empty_object(global, num_properties);
            obj.put(global, ZigString::static_("kind"), kind_jsvalue);
            match &token_generic {
                Token::Option(token) => {
                    obj.put(
                        global,
                        ZigString::static_("index"),
                        JSValue::js_number(token.index as f64),
                    );
                    obj.put(
                        global,
                        ZigString::static_("name"),
                        token.name.as_js_value(global)?,
                    );
                    obj.put(
                        global,
                        ZigString::static_("rawName"),
                        token.make_raw_name_js_value(global)?,
                    );

                    // value exists only for string options, otherwise the property exists with "undefined" as value
                    let value = token.value.as_js_value(global)?;
                    obj.put(global, ZigString::static_("value"), value);
                    obj.put(
                        global,
                        ZigString::static_("inlineValue"),
                        if value.is_undefined() {
                            JSValue::UNDEFINED
                        } else {
                            JSValue::from(token.inline_value)
                        },
                    );
                }
                Token::Positional { index, value } => {
                    obj.put(
                        global,
                        ZigString::static_("index"),
                        JSValue::js_number(*index as f64),
                    );
                    obj.put(
                        global,
                        ZigString::static_("value"),
                        value.as_js_value(global)?,
                    );
                }
                Token::OptionTerminator { index } => {
                    obj.put(
                        global,
                        ZigString::static_("index"),
                        JSValue::js_number(*index as f64),
                    );
                }
            }
            self.tokens.push(global, obj)?;
        }
        Ok(())
    }
}

#[bun_jsc::host_fn(export = "Bun__NodeUtil__jsParseArgs")]
pub fn parse_args(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only, dropped
    let config_value = callframe.arguments_as_array::<1>()[0];
    //
    // Phase 0: parse the config object
    //

    let config = if config_value.is_undefined() {
        None
    } else {
        Some(config_value)
    };

    // Phase 0.A: Get and validate type of input args
    let config_args: JSValue = match config {
        Some(c) => c
            .get_own(global, &String::static_("args"))?
            .unwrap_or(JSValue::UNDEFINED),
        None => JSValue::UNDEFINED,
    };
    let args: ArgsSlice = if !config_args.is_undefined_or_null() {
        validators::validate_array(global, config_args, "args", None)?;
        ArgsSlice {
            array: config_args,
            start: 0,
            end: u32::try_from(config_args.get_length(global)?).expect("int cast"),
        }
    } else {
        get_default_args(global)?
    };

    // Phase 0.B: Parse and validate config

    let config_strict: JSValue = match config {
        Some(c) => c.get_own(global, &String::static_("strict"))?,
        None => None,
    }
    .unwrap_or(JSValue::TRUE);
    let mut config_allow_positionals: JSValue = match config {
        Some(c) => c
            .get_own(global, &String::static_("allowPositionals"))?
            .unwrap_or(JSValue::from(!config_strict.to_boolean())),
        None => JSValue::from(!config_strict.to_boolean()),
    };
    let config_return_tokens: JSValue = match config {
        Some(c) => c.get_own(global, &String::static_("tokens"))?,
        None => None,
    }
    .unwrap_or(JSValue::FALSE);
    let config_allow_negative: JSValue = match config {
        Some(c) => c
            .get_own(global, &String::static_("allowNegative"))?
            .unwrap_or(JSValue::FALSE),
        None => JSValue::FALSE,
    };
    let config_options: JSValue = match config {
        Some(c) => c
            .get_own(global, &String::static_("options"))?
            .unwrap_or(JSValue::UNDEFINED),
        None => JSValue::UNDEFINED,
    };

    let strict = validators::validate_boolean(global, config_strict, "strict")?;

    if config_allow_positionals.is_undefined_or_null() {
        config_allow_positionals = JSValue::from(!strict);
    }

    let allow_positionals =
        validators::validate_boolean(global, config_allow_positionals, "allowPositionals")?;

    let return_tokens = validators::validate_boolean(global, config_return_tokens, "tokens")?;
    let allow_negative =
        validators::validate_boolean(global, config_allow_negative, "allowNegative")?;

    // Phase 0.C: Parse the options definitions

    // PERF(port): was stack-fallback (std.heap.stackFallback(2048, ...)) — profile in Phase B
    let mut option_defs: Vec<OptionDefinition> = Vec::new();

    if !config_options.is_undefined_or_null() {
        parse_option_definitions(global, config_options, &mut option_defs)?;
    }

    //
    // Phase 1: tokenize the args string-array
    //  +
    // Phase 2: process tokens into parsed option values and positionals
    //
    bun_output::scoped_log!(
        parseArgs,
        "Phase 1+2: tokenize args (args.len={})",
        args.end - args.start
    );

    // note that "values" needs to have a null prototype instead of Object, to avoid issues such as "values.toString"` being defined
    let values = JSValue::create_empty_object_with_null_prototype(global);
    let positionals = JSValue::create_empty_array(global, 0)?;
    let tokens: JSValue = if return_tokens {
        JSValue::create_empty_array(global, 0)?
    } else {
        JSValue::UNDEFINED
    };

    let mut state = ParseArgsState {
        global,

        option_defs: &option_defs,
        allow_positionals,
        strict,
        allow_negative,

        values,
        positionals,
        tokens,

        kinds_jsvalues: [None; TokenKind::COUNT],
    };

    tokenize_args(&mut state, global, args, &option_defs)?;

    //
    // Phase 3: fill in default values for missing args
    //
    bun_output::scoped_log!(parseArgs, "Phase 3: fill defaults");

    for option in &option_defs {
        if let Some(default_value) = option.default_value {
            if !option.long_name.eql_comptime(b"__proto__") {
                if state.values.get_own(global, &option.long_name)?.is_none() {
                    bun_output::scoped_log!(
                        parseArgs,
                        "  Setting \"{}\" to default value",
                        option.long_name
                    );
                    state
                        .values
                        .put_may_be_index(global, &option.long_name, default_value)?;
                }
            }
        }
    }

    //
    // Phase 4: build the resulting object: `{ values: {...}, positionals: [...], tokens?: [...] }`
    //
    bun_output::scoped_log!(parseArgs, "Phase 4: Build result object");

    let result = JSValue::create_empty_object(global, if return_tokens { 3 } else { 2 });
    if return_tokens {
        result.put(global, ZigString::static_("tokens"), state.tokens);
    }
    result.put(global, ZigString::static_("values"), state.values);
    result.put(global, ZigString::static_("positionals"), state.positionals);
    Ok(result)
}

// ported from: src/runtime/node/util/parse_args.zig
