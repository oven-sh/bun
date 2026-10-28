"use strict";
// Each function ends in a call of a built-in function that runs code of the program or throws. Every row prints which of the functions named t_.. a stack trace lists.
function namesIn(stack) {
  return String(stack)
    .split("\n")
    .map(line => /(t_[a-zA-Z0-9_]+)/.exec(line))
    .filter(Boolean)
    .map(match => match[1])
    .join(" ");
}
let seen = "";
function probe(result) {
  seen = namesIn(new Error("probe").stack);
  return result;
}
function row(name, run) {
  seen = "(not run)";
  let outcome;
  try {
    outcome = typeof run();
  } catch (error) {
    outcome = error.constructor.name + " [" + namesIn(error.stack) + "]";
  }
  console.log(name + ": [" + seen + "] " + outcome);
}
const results = [];
function t_outer(run) {
  const result = run();
  results.push(result);
  return result;
}

const text = {
  toString() {
    return probe("7");
  },
};
const number = {
  valueOf() {
    return probe(7);
  },
};
const primitive = {
  [Symbol.toPrimitive]() {
    return probe(7);
  },
};
const withGetter = {
  get x() {
    return probe(1);
  },
};
const withToJSON = {
  toJSON() {
    return probe(1);
  },
};
const iterable = {
  [Symbol.iterator]() {
    probe(0);
    return [1][Symbol.iterator]();
  },
};
const thenable = {
  get then() {
    return probe(undefined);
  },
};
const handler = {
  ownKeys() {
    return probe(["a"]);
  },
  getOwnPropertyDescriptor() {
    return { value: 1, enumerable: true, configurable: true };
  },
  get(target, key) {
    return probe(1);
  },
  has() {
    return probe(true);
  },
  getPrototypeOf() {
    return probe(null);
  },
  isExtensible() {
    return probe(true);
  },
  set() {
    return probe(true);
  },
  deleteProperty() {
    return probe(true);
  },
  defineProperty() {
    return probe(true);
  },
  preventExtensions(target) {
    Object.preventExtensions(target);
    return probe(true);
  },
};
const proxy = () => new Proxy({}, handler);

function t_string() {
  return String(text);
}
function t_string_of_primitive() {
  return String(primitive);
}
function t_number() {
  return Number(number);
}
function t_number_of_text() {
  return Number(text);
}
function t_bigint() {
  return BigInt(number);
}
function t_symbol() {
  return Symbol(text);
}
function t_symbol_for() {
  return Symbol.for(text);
}
function t_parse_int() {
  return parseInt(text);
}
function t_parse_int_radix() {
  return parseInt("7", number);
}
function t_parse_float() {
  return parseFloat(text);
}
function t_is_nan() {
  return isNaN(number);
}
function t_is_finite() {
  return isFinite(number);
}
function t_max() {
  return Math.max(number, 2);
}
function t_min() {
  return Math.min(1, number);
}
function t_abs() {
  return Math.abs(number);
}
function t_floor() {
  return Math.floor(number);
}
function t_sqrt() {
  return Math.sqrt(number);
}
function t_pow() {
  return Math.pow(2, number);
}
function t_atan2() {
  return Math.atan2(number, 1);
}
function t_hypot() {
  return Math.hypot(number, 1);
}
function t_imul() {
  return Math.imul(number, 3);
}
function t_clz32() {
  return Math.clz32(number);
}
function t_from_char_code() {
  return String.fromCharCode(number);
}
function t_from_code_point() {
  return String.fromCodePoint(number);
}
function t_char_at() {
  return "abcdefghij".charAt(number);
}
function t_char_code_at() {
  return "abcdefghij".charCodeAt(number);
}
function t_code_point_at() {
  return "abcdefghij".codePointAt(number);
}
function t_string_at() {
  return "abcdefghij".at(number);
}
function t_slice() {
  return "abcdefghij".slice(number);
}
function t_substring() {
  return "abcdefghij".substring(1, number);
}
function t_index_of() {
  return "a7".indexOf(text);
}
function t_includes() {
  return "a7".includes(text);
}
function t_starts_with() {
  return "7a".startsWith(text);
}
function t_ends_with() {
  return "a7".endsWith(text);
}
function t_concat() {
  return "a".concat(text);
}
function t_repeat() {
  return "a".repeat(number);
}
function t_pad_start() {
  return "a".padStart(number, "b");
}
function t_pad_end() {
  return "a".padEnd(9, text);
}
function t_split() {
  return "a7b".split(text);
}
function t_replace() {
  return "a7b".replace(text, "x");
}
function t_replace_with() {
  return "a7b".replace("7", text);
}
function t_replace_all() {
  return "a7b".replaceAll("7", () => probe("x"));
}
function t_locale_compare() {
  return "a".localeCompare(text);
}
function t_trim_of() {
  return String.prototype.trim.call(text);
}
function t_to_fixed() {
  return (1.5).toFixed(number);
}
function t_to_string_radix() {
  return (255).toString(number);
}
function t_to_precision() {
  return (1.5).toPrecision(number);
}
function t_array_at() {
  return [1, 2, 3].at(number);
}
function t_array_slice() {
  return [1, 2, 3].slice(number);
}
function t_array_index_of() {
  return [1, 2, 3].indexOf(1, number);
}
function t_array_includes() {
  return [1, 2, 3].includes(1, number);
}
function t_array_fill() {
  return [1, 2, 3].fill(0, number);
}
function t_array_join() {
  return [text].join();
}
function t_array_join_with() {
  return [1, 2].join(text);
}
function t_array_to_string() {
  return [text].toString();
}
function t_array_from() {
  return Array.from(iterable);
}
function t_array_from_mapped() {
  return Array.from([1], () => probe(1));
}
function t_array_sort() {
  return [2, 1].sort((a, b) => probe(a - b));
}
function t_array_map() {
  return [1].map(() => probe(1));
}
function t_array_find() {
  return [1].find(() => probe(true));
}
function t_array_some() {
  return [1].some(() => probe(true));
}
function t_array_every() {
  return [1].every(() => probe(true));
}
function t_array_flat_map() {
  return [1].flatMap(() => probe([1]));
}
function t_array_reduce() {
  return [1, 2].reduce((a, b) => probe(a + b));
}
function t_array_concat() {
  return [1].concat(proxy());
}
function t_keys() {
  return Object.keys(proxy());
}
function t_values() {
  return Object.values(withGetter);
}
function t_entries() {
  return Object.entries(withGetter);
}
function t_assign() {
  return Object.assign({}, withGetter);
}
function t_own_names() {
  return Object.getOwnPropertyNames(proxy());
}
function t_own_symbols() {
  return Object.getOwnPropertySymbols(proxy());
}
function t_own_descriptors() {
  return Object.getOwnPropertyDescriptors(proxy());
}
function t_prototype_of() {
  return Object.getPrototypeOf(proxy());
}
function t_is_extensible() {
  return Object.isExtensible(proxy());
}
function t_freeze() {
  return Object.freeze(proxy());
}
function t_is_frozen() {
  return Object.isFrozen(proxy());
}
function t_from_entries() {
  return Object.fromEntries(iterable);
}
function t_has_own() {
  return Object.hasOwn({}, text);
}
function t_has_own_property() {
  return {}.hasOwnProperty(text);
}
function t_define_property() {
  return Object.defineProperty(proxy(), "a", { value: 1 });
}
function t_create() {
  return Object.create(null, proxy());
}
function t_reflect_own_keys() {
  return Reflect.ownKeys(proxy());
}
function t_reflect_get() {
  return Reflect.get(withGetter, "x");
}
function t_reflect_get_of_proxy() {
  return Reflect.get(proxy(), "x");
}
function t_reflect_set() {
  return Reflect.set(proxy(), "x", 1);
}
function t_reflect_has() {
  return Reflect.has(proxy(), "x");
}
function t_reflect_delete() {
  return Reflect.deleteProperty(proxy(), "x");
}
function t_reflect_prototype_of() {
  return Reflect.getPrototypeOf(proxy());
}
function t_reflect_apply() {
  return Reflect.apply(probe, undefined, [1]);
}
function t_stringify() {
  return JSON.stringify(withToJSON);
}
function t_stringify_getter() {
  return JSON.stringify(withGetter);
}
function t_stringify_replacer() {
  return JSON.stringify({ a: 1 }, (key, value) => probe(value));
}
function t_parse_reviver() {
  return JSON.parse("[1]", (key, value) => probe(value));
}
function t_parse_text() {
  return JSON.parse(text);
}
function t_encode() {
  return encodeURIComponent(text);
}
function t_decode() {
  return decodeURIComponent(text);
}
function t_date_utc() {
  return Date.UTC(number);
}
function t_date_parse() {
  return Date.parse(text);
}
function t_promise_resolve() {
  return Promise.resolve(thenable);
}
function t_map_for_each() {
  return new Map([[1, 1]]).forEach(() => {
    probe(1);
  });
}
function t_set_for_each() {
  return new Set([1]).forEach(() => {
    probe(1);
  });
}
function t_map_group_by() {
  return Map.groupBy([1], () => probe(1));
}
function t_object_group_by() {
  return Object.groupBy([1], () => probe("a"));
}
function t_call() {
  return probe.call(undefined, 1);
}
function t_apply() {
  return probe.apply(undefined, [1]);
}
function t_bound() {
  return probe.bind(undefined, 1)();
}
function t_regexp_test() {
  return /7/.test(text);
}
function t_regexp_exec() {
  return /7/.exec(text);
}
function t_match() {
  return "a7".match({
    [Symbol.match]() {
      return probe(null);
    },
  });
}
function t_typed_array_from() {
  return Uint8Array.from(iterable);
}
function t_typed_array_fill() {
  return new Uint8Array(2).fill(number);
}
function t_typed_array_at() {
  return new Uint8Array(9).at(number);
}
function t_typed_array_subarray() {
  return new Uint8Array(9).subarray(number);
}

function t_plus() {
  return +number;
}
function t_minus() {
  return -number;
}
function t_template() {
  return `${text}`;
}
function t_add_text() {
  return text + "";
}
function t_times() {
  return number * 2;
}
function t_getter() {
  return withGetter.x;
}
function t_in() {
  return "x" in proxy();
}
function t_argument() {
  return String(probe(1));
}
function t_two_arguments() {
  return Math.max(probe(1), number);
}
function t_not_last() {
  const result = String(text);
  results.push(result);
  return result;
}
function t_in_try() {
  try {
    return String(text);
  } finally {
    seen += " finally";
  }
}
function t_conditional(first) {
  return first ? String(text) : Number(number);
}
function t_logical(first) {
  return first && Number(number);
}
function t_comma() {
  return (0, String(text));
}
const t_arrow = () => String(text);
class Holder {
  t_method() {
    return String(text);
  }
  static t_static() {
    return Number(number);
  }
  get t_accessor() {
    return String(text);
  }
}

function t_throws_receiver(receiver) {
  return receiver.trim();
}
function t_throws_bigint() {
  return BigInt(1.5);
}
function t_throws_repeat() {
  return "a".repeat(-1);
}
function t_throws_parse() {
  return JSON.parse("{");
}
function t_throws_to_fixed() {
  return (1).toFixed(101);
}
function t_throws_decode() {
  return decodeURIComponent("%");
}
function t_throws_code_point() {
  return String.fromCodePoint(-1);
}
function t_throws_normalize() {
  return "a".normalize("x");
}
function t_throws_define() {
  return Object.defineProperty(1, "a", {});
}
function t_throws_own_keys() {
  return Reflect.ownKeys(1);
}
function t_throws_reduce() {
  return [].reduce((a, b) => a);
}
function t_throws_string_radix() {
  return (1).toString(1);
}
function t_throws_not_callable(callee) {
  return callee();
}
function t_throws_map_callback() {
  return [1].map(1);
}
function t_throws_in_callback() {
  return [1].map(() => {
    throw new RangeError("in the callback");
  });
}
function t_throws_in_to_string() {
  return String({
    toString() {
      throw new RangeError("in toString");
    },
  });
}
function t_throws_in_value_of() {
  return Math.max(
    {
      valueOf() {
        throw new RangeError("in valueOf");
      },
    },
    1,
  );
}
function t_throws_in_own_keys() {
  return Object.keys(
    new Proxy(
      {},
      {
        ownKeys() {
          throw new RangeError("in ownKeys");
        },
      },
    ),
  );
}
function t_throws_array_length() {
  return Array(-1);
}
function t_throws_symbol_to_text() {
  return `${Symbol()}`;
}

const functions = [
  t_string,
  t_string_of_primitive,
  t_number,
  t_number_of_text,
  t_bigint,
  t_symbol,
  t_symbol_for,
  t_parse_int,
  t_parse_int_radix,
  t_parse_float,
  t_is_nan,
  t_is_finite,
  t_max,
  t_min,
  t_abs,
  t_floor,
  t_sqrt,
  t_pow,
  t_atan2,
  t_hypot,
  t_imul,
  t_clz32,
  t_from_char_code,
  t_from_code_point,
  t_char_at,
  t_char_code_at,
  t_code_point_at,
  t_string_at,
  t_slice,
  t_substring,
  t_index_of,
  t_includes,
  t_starts_with,
  t_ends_with,
  t_concat,
  t_repeat,
  t_pad_start,
  t_pad_end,
  t_split,
  t_replace,
  t_replace_with,
  t_replace_all,
  t_locale_compare,
  t_trim_of,
  t_to_fixed,
  t_to_string_radix,
  t_to_precision,
  t_array_at,
  t_array_slice,
  t_array_index_of,
  t_array_includes,
  t_array_fill,
  t_array_join,
  t_array_join_with,
  t_array_to_string,
  t_array_from,
  t_array_from_mapped,
  t_array_sort,
  t_array_map,
  t_array_find,
  t_array_some,
  t_array_every,
  t_array_flat_map,
  t_array_reduce,
  t_array_concat,
  t_keys,
  t_values,
  t_entries,
  t_assign,
  t_own_names,
  t_own_symbols,
  t_own_descriptors,
  t_prototype_of,
  t_is_extensible,
  t_freeze,
  t_is_frozen,
  t_from_entries,
  t_has_own,
  t_has_own_property,
  t_define_property,
  t_create,
  t_reflect_own_keys,
  t_reflect_get,
  t_reflect_get_of_proxy,
  t_reflect_set,
  t_reflect_has,
  t_reflect_delete,
  t_reflect_prototype_of,
  t_reflect_apply,
  t_stringify,
  t_stringify_getter,
  t_stringify_replacer,
  t_parse_reviver,
  t_parse_text,
  t_encode,
  t_decode,
  t_date_utc,
  t_date_parse,
  t_promise_resolve,
  t_map_for_each,
  t_set_for_each,
  t_map_group_by,
  t_object_group_by,
  t_call,
  t_apply,
  t_bound,
  t_regexp_test,
  t_regexp_exec,
  t_match,
  t_typed_array_from,
  t_typed_array_fill,
  t_typed_array_at,
  t_typed_array_subarray,
  t_plus,
  t_minus,
  t_template,
  t_add_text,
  t_times,
  t_getter,
  t_in,
  t_argument,
  t_two_arguments,
  t_not_last,
  t_in_try,
  t_comma,
  t_arrow,
  t_throws_bigint,
  t_throws_repeat,
  t_throws_parse,
  t_throws_to_fixed,
  t_throws_decode,
  t_throws_code_point,
  t_throws_normalize,
  t_throws_define,
  t_throws_own_keys,
  t_throws_reduce,
  t_throws_string_radix,
  t_throws_map_callback,
  t_throws_in_callback,
  t_throws_in_to_string,
  t_throws_in_value_of,
  t_throws_in_own_keys,
  t_throws_array_length,
  t_throws_symbol_to_text,
];
for (let turn = 0; turn < 2; turn++) {
  for (const run of functions) row(run.name + " " + turn, () => t_outer(run));
  row("t_conditional true " + turn, () => t_outer(() => t_conditional(true)));
  row("t_conditional false " + turn, () => t_outer(() => t_conditional(false)));
  row("t_logical " + turn, () => t_outer(() => t_logical(true)));
  row("t_method " + turn, () => t_outer(() => new Holder().t_method()));
  row("t_static " + turn, () => t_outer(() => Holder.t_static()));
  row("t_accessor " + turn, () => t_outer(() => new Holder().t_accessor));
  row("t_throws_receiver null " + turn, () => t_outer(() => t_throws_receiver(null)));
  row("t_throws_receiver undefined " + turn, () => t_outer(() => t_throws_receiver(undefined)));
  row("t_throws_receiver object " + turn, () => t_outer(() => t_throws_receiver({})));
  row("t_throws_not_callable " + turn, () => t_outer(() => t_throws_not_callable(1)));
}
