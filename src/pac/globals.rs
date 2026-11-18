//! <https://developer.mozilla.org/docs/Web/HTTP/Guides/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file>

use std::io::Write as _;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Instant;

use bun_core::strings;

use crate::builtins::*;
use crate::calendar::{DATE_METHODS, date_method, new_date, range};
use crate::machine::*;
use crate::syntax::push_unit;

const MAX_LOOKUPS: usize = 20;

pub(crate) fn install(it: &mut Machine<'_>) {
    for id in 0..BUILT_IN {
        it.allocate(Kind::Plain, (id > OBJECTS).then_some(OBJECTS));
    }
    let methods: [(Id, Native, &[&str]); 10] = [
        (
            OBJECTS,
            object_method,
            &["hasOwnProperty", "toString", "valueOf"],
        ),
        (STRINGS, string_method, STRING_METHODS),
        (ARRAYS, array_method, ARRAY_METHODS),
        (ARRAYS, iterating_method, ITERATING_METHODS),
        (PATTERNS, pattern_method, &["exec", "test", "toString"]),
        (NUMBERS, number_method, &["toFixed", "toString", "valueOf"]),
        (DATES, date_method, DATE_METHODS),
        (FUNCTIONS, function_method, &["apply", "call"]),
        (
            MAPS,
            collection_method,
            &[
                "clear", "delete", "entries", "forEach", "get", "has", "keys", "set", "values",
            ],
        ),
        (
            SETS,
            collection_method,
            &[
                "add", "clear", "delete", "entries", "forEach", "has", "keys", "values",
            ],
        ),
    ];
    for (prototype, run, names) in methods {
        it.define_natives(prototype, run, names);
    }
    let constructors: [(&str, Native, Id, &[&str]); 12] = [
        ("Array", language, ARRAYS, &["from", "isArray"]),
        ("Boolean", language, OBJECTS, &[]),
        ("Date", new_date, DATES, &["now"]),
        ("Error", language, OBJECTS, &[]),
        ("Map", new_collection, MAPS, &[]),
        (
            "Number",
            language,
            NUMBERS,
            &["isNaN", "parseFloat", "parseInt"],
        ),
        (
            "Object",
            language,
            OBJECTS,
            &["assign", "create", "entries", "freeze", "keys", "values"],
        ),
        ("RangeError", language, OBJECTS, &[]),
        ("RegExp", language, PATTERNS, &[]),
        ("Set", new_collection, SETS, &[]),
        ("TypeError", language, OBJECTS, &[]),
        ("String", language, STRINGS, &["fromCharCode"]),
    ];
    for (name, run, prototype, statics) in constructors {
        let constructor = it.new_native(run, name);
        it.define(constructor, b"prototype", Value::Object(prototype));
        it.define_natives(constructor, run, statics);
        it.define_global(name, Value::Object(constructor));
    }
    let functions: [(Native, &[&str]); 3] = [
        (
            language,
            &[
                "alert",
                "decodeURIComponent",
                "encodeURIComponent",
                "isNaN",
                "parseFloat",
                "parseInt",
            ],
        ),
        (range, &["dateRange", "timeRange", "weekdayRange"]),
        (
            network,
            &[
                "convert_addr",
                "dnsDomainIs",
                "dnsDomainLevels",
                "dnsResolve",
                "dnsResolveEx",
                "isInNet",
                "isInNetEx",
                "isPlainHostName",
                "isResolvable",
                "isResolvableEx",
                "localHostOrDomainIs",
                "myIpAddress",
                "myIpAddressEx",
                "shExpMatch",
            ],
        ),
    ];
    for (run, name) in functions
        .into_iter()
        .flat_map(|(run, names)| names.iter().map(move |it| (run, *it)))
    {
        let function = it.new_native(run, name);
        it.define_global(name, Value::Object(function));
    }
    let math = it.allocate(Kind::Plain, Some(OBJECTS));
    it.define_natives(
        math,
        mathematics,
        &[
            "abs", "ceil", "floor", "max", "min", "pow", "random", "round", "sqrt",
        ],
    );
    for (name, value) in [
        ("Math", Value::Object(math)),
        ("undefined", Value::Undefined),
        ("NaN", f64::NAN.into()),
        ("Infinity", f64::INFINITY.into()),
    ] {
        it.define_global(name, value);
    }
}

fn mathematics(it: &mut Machine<'_>, name: &str, _: &Value, arguments: &[Value]) -> Outcome {
    let numbers = arguments
        .iter()
        .map(|argument| it.number(argument))
        .collect::<Outcome<Vec<_>>>()?;
    let [x, y] = [0, 1].map(|index| numbers.get(index).copied().unwrap_or(f64::NAN));
    Ok(Value::Number(match name {
        "max" | "min" if numbers.iter().any(|it| it.is_nan()) => f64::NAN,
        "max" => numbers.into_iter().fold(f64::NEG_INFINITY, f64::max),
        "min" => numbers.into_iter().fold(f64::INFINITY, f64::min),
        "abs" => x.abs(),
        "ceil" => x.ceil(),
        "floor" => x.floor(),
        "pow" => x.powf(y),
        "round" => (x + 0.5).floor(),
        "sqrt" => x.sqrt(),
        _ => (bun_core::fast_random() >> 11) as f64 / (1u64 << 53) as f64,
    }))
}

fn parse_int(text: &[u8], radix: u32) -> f64 {
    let text = trim(text);
    let unsigned = text
        .strip_prefix(b"-")
        .or_else(|| text.strip_prefix(b"+"))
        .unwrap_or(text);
    let (digits, radix) = match (unsigned, radix) {
        ([b'0', b'x' | b'X', digits @ ..], 0 | 16) => (digits, 16),
        (_, 0) => (unsigned, 10),
        (_, 2..=36) => (unsigned, radix),
        _ => return f64::NAN,
    };
    let number = digits
        .iter()
        .map_while(|it| char::from(*it).to_digit(radix))
        .map(f64::from)
        .reduce(|all, it| all * f64::from(radix) + it);
    number.map_or(f64::NAN, |it| if text.starts_with(b"-") { -it } else { it })
}

fn language(it: &mut Machine<'_>, name: &str, _: &Value, arguments: &[Value]) -> Outcome {
    let (first, second) = (nth(arguments, 0), nth(arguments, 1));
    match name {
        "alert" => Ok(Value::Undefined),
        "Array" if let [Value::Number(len)] = arguments => {
            it.check_length(*len as usize, 1)?;
            it.new_array(vec![Value::Undefined; *len as usize])
        }
        "Array" => it.new_array(arguments.to_vec()),
        "isArray" => Ok(it.items(first).is_some().into()),
        "Boolean" => Ok(first.is_truthy().into()),
        "from" => it.iterate(first).and_then(|items| it.new_array(items)),
        "freeze" => Ok(first.clone()),
        "assign" => arguments
            .iter()
            .skip(1)
            .try_for_each(|from| it.copy_properties(from, first))
            .map(|()| first.clone()),
        "Error" | "RangeError" | "TypeError" => Ok(it.new_error(name, first.clone())),
        "Number" => arguments
            .first()
            .map_or(Ok(0.0), |first| it.number(first))
            .map(Value::Number),
        "isNaN" => Ok(it.number(first)?.is_nan().into()),
        "Object" => Ok(it.new_object_like(&Value::Undefined)),
        "create" => Ok(it.new_object_like(first)),
        "keys" | "values" | "entries" => {
            let mut all = it.own_keys(first)?;
            for each in all.iter_mut().filter(|_| name != "keys") {
                let value = it.get(first, each)?;
                *each = if name == "values" {
                    value
                } else {
                    it.new_array(vec![each.clone(), value])?
                };
            }
            it.new_array(all)
        }
        "RegExp" => {
            let known = it
                .pattern(first)
                .map(|it| (Arc::clone(&it.source), Arc::clone(&it.flags)));
            let (source, flags) =
                known.map_or_else(|| Ok((it.text(first)?, Text::default())), Ok)?;
            let flags = second.given().map_or(Ok(flags), |given| it.text(given))?;
            it.new_pattern(&source, &flags)
        }
        "String" => arguments
            .first()
            .map_or_else(|| Ok(Text::default()), |first| it.text(first))
            .map(Value::String),
        "fromCharCode" => {
            let mut text = Vec::new();
            for unit in arguments {
                push_unit(&mut text, (int32_of(it.number(unit)?) as u16).into());
            }
            it.new_string(&text)
        }
        "parseInt" => Ok(parse_int(&it.text(first)?, int32_of(it.number(second)?) as u32).into()),
        "parseFloat" => Ok(bun_core::fmt::parse_double(trim(&it.text(first)?))
            .unwrap_or(f64::NAN)
            .into()),
        "encodeURIComponent" => {
            let mut out = Vec::new();
            for byte in it.text(first)?.iter() {
                match byte.is_ascii_alphanumeric() || strings::contains_char(b"-_.!~*'()", *byte) {
                    true => out.push(*byte),
                    false => _ = write!(out, "%{byte:02X}"),
                }
            }
            it.new_string(&out)
        }
        _ => {
            let text = it.text(first)?;
            let mut parts = strings::split(&text, b"%");
            let mut out = parts.next().unwrap_or_default().to_vec();
            for part in parts {
                let Some(Ok(byte)) = part
                    .get(..2)
                    .map(|it| bun_core::fmt::parse_unsigned(it, 16))
                else {
                    return it.throw("URIError", "URI malformed");
                };
                out.push(byte);
                out.extend_from_slice(&part[2..]);
            }
            it.new_string(&out)
        }
    }
}

fn parse<T: core::str::FromStr>(text: &[u8]) -> Option<T> {
    core::str::from_utf8(text).ok()?.parse().ok()
}

/// `network` is an address, a slash and the length of the prefix.
pub fn is_in_network(address: &[u8], network: &[u8]) -> bool {
    let unbracketed = |it| parse::<IpAddr>(strings::trim(it, b"[]"));
    let Some((first, bits)) = strings::split_once_char(network, b'/') else {
        return false;
    };
    let (differs, len) = match (unbracketed(address), unbracketed(first)) {
        (Some(IpAddr::V4(a)), Some(IpAddr::V4(b))) => {
            (u128::from(a.to_bits() ^ b.to_bits()) << 96, 32)
        }
        (Some(IpAddr::V6(a)), Some(IpAddr::V6(b))) => (a.to_bits() ^ b.to_bits(), 128),
        _ => return false,
    };
    parse::<u32>(bits).is_some_and(|it| it <= len && differs.leading_zeros() >= it)
}

/// `*` stands for anything, and `?` for one character.
fn shell_matches(pattern: &[u8], text: &[u8]) -> bool {
    let (mut wanted, mut at, mut last_star) = (0, 0, None);
    while at < text.len() {
        match pattern.get(wanted) {
            Some(b'*') => {
                wanted += 1;
                last_star = Some((wanted, at));
            }
            Some(byte) if *byte == b'?' || *byte == text[at] => (wanted, at) = (wanted + 1, at + 1),
            _ => {
                let Some((after, tried)) = last_star else {
                    return false;
                };
                (wanted, at, last_star) = (after, tried + 1, Some((after, tried + 1)));
            }
        }
    }
    pattern[wanted..].iter().all(|it| *it == b'*')
}

fn joined(addresses: &[IpAddr]) -> Value {
    addresses
        .iter()
        .map(IpAddr::to_string)
        .collect::<Vec<_>>()
        .join(";")
        .as_bytes()
        .into()
}

fn first_v4(addresses: Vec<IpAddr>) -> Option<Ipv4Addr> {
    addresses.into_iter().find_map(|it| {
        if let IpAddr::V4(it) = it {
            Some(it)
        } else {
            None
        }
    })
}

impl Machine<'_> {
    fn resolve(&mut self, name: &Text) -> Outcome<Vec<IpAddr>> {
        if let Some(address) = parse(name) {
            return Ok(vec![address]);
        }
        if let Some(known) = self.resolved.iter().find(|it| it.0 == *name) {
            return Ok(known.1.clone());
        }
        if self.resolved.len() == MAX_LOOKUPS {
            return Err(Abrupt::Abort);
        }
        let started = Instant::now();
        let addresses = self.host.resolve(name);
        self.deadline += started.elapsed();
        self.resolved.push((Arc::clone(name), addresses.clone()));
        Ok(addresses)
    }
}

fn network(it: &mut Machine<'_>, name: &str, _: &Value, arguments: &[Value]) -> Outcome {
    let (first, second, third) = (
        it.text(nth(arguments, 0))?,
        it.text(nth(arguments, 1))?,
        it.text(nth(arguments, 2))?,
    );
    it.spend((first.len() + second.len()) / 8)?;
    Ok(match name {
        "convert_addr" => f64::from(int32_of(
            strings::split(&first, b".").fold(0.0, |all, it| all * 256.0 + number_of_text(it)),
        ))
        .into(),
        "dnsDomainIs" => first.ends_with(&second).into(),
        "dnsDomainLevels" => strings::count_char(&first, b'.').into(),
        "dnsResolve" => {
            first_v4(it.resolve(&first)?).map_or(Value::Null, |it| it.to_string().as_bytes().into())
        }
        "dnsResolveEx" => joined(&it.resolve(&first)?),
        "isInNet" => match (parse::<Ipv4Addr>(&second), parse::<Ipv4Addr>(&third)) {
            (Some(pattern), Some(mask)) => first_v4(it.resolve(&first)?)
                .is_some_and(|it| it & mask == pattern & mask)
                .into(),
            _ => false.into(),
        },
        "isInNetEx" => strings::split(&first, b";")
            .any(|it| is_in_network(it, &second))
            .into(),
        "isPlainHostName" => (!strings::contains_any(&first, b".:")).into(),
        "isResolvable" => first_v4(it.resolve(&first)?).is_some().into(),
        "isResolvableEx" => (!it.resolve(&first)?.is_empty()).into(),
        "localHostOrDomainIs" => second
            .strip_prefix(&*first)
            .is_some_and(|it| matches!(it, [] | [b'.', ..]))
            .into(),
        "myIpAddress" => first_v4(it.host.own_addresses())
            .unwrap_or(Ipv4Addr::LOCALHOST)
            .to_string()
            .as_bytes()
            .into(),
        "myIpAddressEx" => joined(&it.host.own_addresses()),
        _ if strings::contains_any(&second, b"[(|+^$\\{") => {
            let mut source = vec![b'^'];
            for byte in second.iter() {
                source.extend_from_slice(match byte {
                    b'.' => b"\\.",
                    b'*' => b".*",
                    b'?' => b".",
                    _ => core::slice::from_ref(byte),
                });
            }
            source.push(b'$');
            let pattern = it.new_pattern(&source.into(), &Text::default())?;
            pattern_method(it, "test", &pattern, arguments)?
        }
        _ => {
            it.spend(first.len() * second.len() / 64)?;
            shell_matches(&second, &first).into()
        }
    })
}
