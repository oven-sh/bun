import * as L from "own_parameters_0";
const values = () => [
  "a", "", "abc", "1", 0, 1, -1, 2, 1.5, -0, NaN, Infinity, 2 ** 31, 2 ** 53, true, false, null, undefined, 10n, Symbol("s"),
  {}, { a: 1, b: "b" }, { b: "b", a: 1 }, { a: "1", b: 2, c: 3 }, { length: 2, 0: "a", 1: 1 }, { get a() { return "from a getter"; }, b: 0 }, Object.create({ a: "inherited", b: "inherited" }), Object.create(null),
  { x: 1, y: 2 }, { y: 2, x: 1 }, { m(x) { return [x, this === undefined]; }, inner: { a: "inner a" }, then: 1, size: "size", get: () => "got", has: () => "had" },
  [], [1, 2], ["a", 1], [1, , 3], [1.5, "x", null], new Array(3), Object.freeze([1, 2]), new Uint8Array([1, 2]), new Float64Array([1.5]),
  new String("ab"), new Number(3), new Boolean(false), Object(1n),
  Object.assign(function named(x, y) { return [x, y]; }, { toString: () => "text of named" }), Object.assign((x) => x, { toString: () => "text of an arrow" }), class C { static toString() { return "text of C"; } },
  new Map([["a", 1]]), new Set([1]), new Date(0), /a/, new URL("http://h/p?q"), new Request("http://h/r"), Promise.resolve(1), new Error("e"),
  new Proxy({}, { get: (t, k) => typeof k === "symbol" ? undefined : "proxied " + k, has: () => true }), new Proxy([1, 2], {}),
  { valueOf() { return 7; } }, { toString() { return "text of an object"; } }, { [Symbol.toPrimitive]() { return "primitive"; } },
];
const seen = (v, depth = 0) => {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "symbol" || v === undefined || v === null || typeof v === "boolean") return String(v);
  if (typeof v === "function") return "fn:" + v.name;
  if (depth > 3) return "..";
  if (Array.isArray(v)) return "[" + Array.from(v, (x) => seen(x, depth + 1)).join() + "]";
  let tag; try { tag = Object.prototype.toString.call(v).slice(8, -1); } catch { tag = "?"; }
  let names; try { names = Object.keys(v); } catch { names = []; }
  return tag + "{" + names.map((k) => { try { return k + ":" + seen(v[k], depth + 1); } catch (e) { return k + ":!" + e.name; } }).join() + "}";
};
const pending = [];
const attempt = (name, f) => {
  let said;
  try { const v = f(); if (v instanceof Promise) pending.push(v.then((x) => name + " later " + seen(x), (e) => name + " later THROWS " + (e && e.name))); said = seen(v); } catch (e) { said = "THROWS " + (e && e.name); }
  console.log(name, said);
};
{ const f = L.p_fewer;
  values().forEach((v, i) => attempt("p_fewer " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_fewer a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_fewer 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_fewer same " + i, () => f(v, v)));
  attempt("p_fewer none", () => f());
  attempt("p_fewer many", () => f("a", 1, true, null, {}));
  attempt("p_fewer call", () => f.call({ k: 1 }, "a"));
  attempt("p_fewer length", () => [f.length, f.name]);
}
{ const f = L.p_more;
  values().forEach((v, i) => attempt("p_more " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_more a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_more 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_more same " + i, () => f(v, v)));
  attempt("p_more none", () => f());
  attempt("p_more many", () => f("a", 1, true, null, {}));
  attempt("p_more call", () => f.call({ k: 1 }, "a"));
  attempt("p_more length", () => [f.length, f.name]);
}
{ const f = L.p_none;
  values().forEach((v, i) => attempt("p_none " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_none a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_none 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_none same " + i, () => f(v, v)));
  attempt("p_none none", () => f());
  attempt("p_none many", () => f("a", 1, true, null, {}));
  attempt("p_none call", () => f.call({ k: 1 }, "a"));
  attempt("p_none length", () => [f.length, f.name]);
}
{ const f = L.p_swapped;
  values().forEach((v, i) => attempt("p_swapped " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_swapped a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_swapped 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_swapped same " + i, () => f(v, v)));
  attempt("p_swapped none", () => f());
  attempt("p_swapped many", () => f("a", 1, true, null, {}));
  attempt("p_swapped call", () => f.call({ k: 1 }, "a"));
  attempt("p_swapped length", () => [f.length, f.name]);
}
{ const f = L.p_optional;
  values().forEach((v, i) => attempt("p_optional " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_optional a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_optional 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_optional same " + i, () => f(v, v)));
  attempt("p_optional none", () => f());
  attempt("p_optional many", () => f("a", 1, true, null, {}));
  attempt("p_optional call", () => f.call({ k: 1 }, "a"));
  attempt("p_optional length", () => [f.length, f.name]);
}
{ const f = L.p_required;
  values().forEach((v, i) => attempt("p_required " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_required a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_required 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_required same " + i, () => f(v, v)));
  attempt("p_required none", () => f());
  attempt("p_required many", () => f("a", 1, true, null, {}));
  attempt("p_required call", () => f.call({ k: 1 }, "a"));
  attempt("p_required length", () => [f.length, f.name]);
}
{ const f = L.p_default;
  values().forEach((v, i) => attempt("p_default " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_default a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_default 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_default same " + i, () => f(v, v)));
  attempt("p_default none", () => f());
  attempt("p_default many", () => f("a", 1, true, null, {}));
  attempt("p_default call", () => f.call({ k: 1 }, "a"));
  attempt("p_default length", () => [f.length, f.name]);
}
{ const f = L.p_rest_declared;
  values().forEach((v, i) => attempt("p_rest_declared " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_rest_declared a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_rest_declared 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_rest_declared same " + i, () => f(v, v)));
  attempt("p_rest_declared none", () => f());
  attempt("p_rest_declared many", () => f("a", 1, true, null, {}));
  attempt("p_rest_declared call", () => f.call({ k: 1 }, "a"));
  attempt("p_rest_declared length", () => [f.length, f.name]);
}
{ const f = L.p_rest_written;
  values().forEach((v, i) => attempt("p_rest_written " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_rest_written a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_rest_written 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_rest_written same " + i, () => f(v, v)));
  attempt("p_rest_written none", () => f());
  attempt("p_rest_written many", () => f("a", 1, true, null, {}));
  attempt("p_rest_written call", () => f.call({ k: 1 }, "a"));
  attempt("p_rest_written length", () => [f.length, f.name]);
}
{ const f = L.p_rest_behind;
  values().forEach((v, i) => attempt("p_rest_behind " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_rest_behind a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_rest_behind 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_rest_behind same " + i, () => f(v, v)));
  attempt("p_rest_behind none", () => f());
  attempt("p_rest_behind many", () => f("a", 1, true, null, {}));
  attempt("p_rest_behind call", () => f.call({ k: 1 }, "a"));
  attempt("p_rest_behind length", () => [f.length, f.name]);
}
{ const f = L.p_object_pattern;
  values().forEach((v, i) => attempt("p_object_pattern " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_object_pattern a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_object_pattern 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_object_pattern same " + i, () => f(v, v)));
  attempt("p_object_pattern none", () => f());
  attempt("p_object_pattern many", () => f("a", 1, true, null, {}));
  attempt("p_object_pattern call", () => f.call({ k: 1 }, "a"));
  attempt("p_object_pattern length", () => [f.length, f.name]);
}
{ const f = L.p_pattern_is_string;
  values().forEach((v, i) => attempt("p_pattern_is_string " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_pattern_is_string a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_pattern_is_string 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_pattern_is_string same " + i, () => f(v, v)));
  attempt("p_pattern_is_string none", () => f());
  attempt("p_pattern_is_string many", () => f("a", 1, true, null, {}));
  attempt("p_pattern_is_string call", () => f.call({ k: 1 }, "a"));
  attempt("p_pattern_is_string length", () => [f.length, f.name]);
}
{ const f = L.p_array_pattern;
  values().forEach((v, i) => attempt("p_array_pattern " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_array_pattern a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_array_pattern 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_array_pattern same " + i, () => f(v, v)));
  attempt("p_array_pattern none", () => f());
  attempt("p_array_pattern many", () => f("a", 1, true, null, {}));
  attempt("p_array_pattern call", () => f.call({ k: 1 }, "a"));
  attempt("p_array_pattern length", () => [f.length, f.name]);
}
{ const f = L.p_assigned;
  values().forEach((v, i) => attempt("p_assigned " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_assigned a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_assigned 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_assigned same " + i, () => f(v, v)));
  attempt("p_assigned none", () => f());
  attempt("p_assigned many", () => f("a", 1, true, null, {}));
  attempt("p_assigned call", () => f.call({ k: 1 }, "a"));
  attempt("p_assigned length", () => [f.length, f.name]);
}
{ const f = L.p_or_default;
  values().forEach((v, i) => attempt("p_or_default " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_or_default a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_or_default 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_or_default same " + i, () => f(v, v)));
  attempt("p_or_default none", () => f());
  attempt("p_or_default many", () => f("a", 1, true, null, {}));
  attempt("p_or_default call", () => f.call({ k: 1 }, "a"));
  attempt("p_or_default length", () => [f.length, f.name]);
}
{ const f = L.p_arguments;
  values().forEach((v, i) => attempt("p_arguments " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_arguments a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_arguments 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_arguments same " + i, () => f(v, v)));
  attempt("p_arguments none", () => f());
  attempt("p_arguments many", () => f("a", 1, true, null, {}));
  attempt("p_arguments call", () => f.call({ k: 1 }, "a"));
  attempt("p_arguments length", () => [f.length, f.name]);
}
{ const f = L.p_captured;
  values().forEach((v, i) => attempt("p_captured " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_captured a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_captured 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_captured same " + i, () => f(v, v)));
  attempt("p_captured none", () => f());
  attempt("p_captured many", () => f("a", 1, true, null, {}));
  attempt("p_captured call", () => f.call({ k: 1 }, "a"));
  attempt("p_captured length", () => [f.length, f.name]);
}
{ const f = L.p_this;
  values().forEach((v, i) => attempt("p_this " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_this a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_this 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_this same " + i, () => f(v, v)));
  attempt("p_this none", () => f());
  attempt("p_this many", () => f("a", 1, true, null, {}));
  attempt("p_this call", () => f.call({ k: 1 }, "a"));
  attempt("p_this length", () => [f.length, f.name]);
}
{ const f = L.p_same_name;
  values().forEach((v, i) => attempt("p_same_name " + i, () => f(v)));
  values().forEach((v, i) => attempt("p_same_name a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("p_same_name 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("p_same_name same " + i, () => f(v, v)));
  attempt("p_same_name none", () => f());
  attempt("p_same_name many", () => f("a", 1, true, null, {}));
  attempt("p_same_name call", () => f.call({ k: 1 }, "a"));
  attempt("p_same_name length", () => [f.length, f.name]);
}
for (const line of await Promise.all(pending)) console.log(line);
