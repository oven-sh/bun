import * as L from "own_strings_0";
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
{ const f = L.s_length;
  values().forEach((v, i) => attempt("s_length " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_length a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_length 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_length same " + i, () => f(v, v)));
  attempt("s_length none", () => f());
  attempt("s_length many", () => f("a", 1, true, null, {}));
  attempt("s_length call", () => f.call({ k: 1 }, "a"));
  attempt("s_length length", () => [f.length, f.name]);
}
{ const f = L.s_index;
  values().forEach((v, i) => attempt("s_index " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_index a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_index 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_index same " + i, () => f(v, v)));
  attempt("s_index none", () => f());
  attempt("s_index many", () => f("a", 1, true, null, {}));
  attempt("s_index call", () => f.call({ k: 1 }, "a"));
  attempt("s_index length", () => [f.length, f.name]);
}
{ const f = L.s_scan;
  values().forEach((v, i) => attempt("s_scan " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_scan a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_scan 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_scan same " + i, () => f(v, v)));
  attempt("s_scan none", () => f());
  attempt("s_scan many", () => f("a", 1, true, null, {}));
  attempt("s_scan call", () => f.call({ k: 1 }, "a"));
  attempt("s_scan length", () => [f.length, f.name]);
}
{ const f = L.s_code;
  values().forEach((v, i) => attempt("s_code " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_code a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_code 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_code same " + i, () => f(v, v)));
  attempt("s_code none", () => f());
  attempt("s_code many", () => f("a", 1, true, null, {}));
  attempt("s_code call", () => f.call({ k: 1 }, "a"));
  attempt("s_code length", () => [f.length, f.name]);
}
{ const f = L.s_concat;
  values().forEach((v, i) => attempt("s_concat " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_concat a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_concat 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_concat same " + i, () => f(v, v)));
  attempt("s_concat none", () => f());
  attempt("s_concat many", () => f("a", 1, true, null, {}));
  attempt("s_concat call", () => f.call({ k: 1 }, "a"));
  attempt("s_concat length", () => [f.length, f.name]);
}
{ const f = L.s_template;
  values().forEach((v, i) => attempt("s_template " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_template a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_template 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_template same " + i, () => f(v, v)));
  attempt("s_template none", () => f());
  attempt("s_template many", () => f("a", 1, true, null, {}));
  attempt("s_template call", () => f.call({ k: 1 }, "a"));
  attempt("s_template length", () => [f.length, f.name]);
}
{ const f = L.s_equal;
  values().forEach((v, i) => attempt("s_equal " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_equal a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_equal 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_equal same " + i, () => f(v, v)));
  attempt("s_equal none", () => f());
  attempt("s_equal many", () => f("a", 1, true, null, {}));
  attempt("s_equal call", () => f.call({ k: 1 }, "a"));
  attempt("s_equal length", () => [f.length, f.name]);
}
{ const f = L.s_slice;
  values().forEach((v, i) => attempt("s_slice " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_slice a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_slice 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_slice same " + i, () => f(v, v)));
  attempt("s_slice none", () => f());
  attempt("s_slice many", () => f("a", 1, true, null, {}));
  attempt("s_slice call", () => f.call({ k: 1 }, "a"));
  attempt("s_slice length", () => [f.length, f.name]);
}
{ const f = L.s_switch;
  values().forEach((v, i) => attempt("s_switch " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_switch a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_switch 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_switch same " + i, () => f(v, v)));
  attempt("s_switch none", () => f());
  attempt("s_switch many", () => f("a", 1, true, null, {}));
  attempt("s_switch call", () => f.call({ k: 1 }, "a"));
  attempt("s_switch length", () => [f.length, f.name]);
}
{ const f = L.s_key;
  values().forEach((v, i) => attempt("s_key " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_key a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_key 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_key same " + i, () => f(v, v)));
  attempt("s_key none", () => f());
  attempt("s_key many", () => f("a", 1, true, null, {}));
  attempt("s_key call", () => f.call({ k: 1 }, "a"));
  attempt("s_key length", () => [f.length, f.name]);
}
{ const f = L.s_truthy;
  values().forEach((v, i) => attempt("s_truthy " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_truthy a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_truthy 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_truthy same " + i, () => f(v, v)));
  attempt("s_truthy none", () => f());
  attempt("s_truthy many", () => f("a", 1, true, null, {}));
  attempt("s_truthy call", () => f.call({ k: 1 }, "a"));
  attempt("s_truthy length", () => [f.length, f.name]);
}
{ const f = L.s_typeof;
  values().forEach((v, i) => attempt("s_typeof " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_typeof a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_typeof 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_typeof same " + i, () => f(v, v)));
  attempt("s_typeof none", () => f());
  attempt("s_typeof many", () => f("a", 1, true, null, {}));
  attempt("s_typeof call", () => f.call({ k: 1 }, "a"));
  attempt("s_typeof length", () => [f.length, f.name]);
}
{ const f = L.s_spread;
  values().forEach((v, i) => attempt("s_spread " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_spread a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_spread 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_spread same " + i, () => f(v, v)));
  attempt("s_spread none", () => f());
  attempt("s_spread many", () => f("a", 1, true, null, {}));
  attempt("s_spread call", () => f.call({ k: 1 }, "a"));
  attempt("s_spread length", () => [f.length, f.name]);
}
{ const f = L.s_stored;
  values().forEach((v, i) => attempt("s_stored " + i, () => f(v)));
  values().forEach((v, i) => attempt("s_stored a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("s_stored 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("s_stored same " + i, () => f(v, v)));
  attempt("s_stored none", () => f());
  attempt("s_stored many", () => f("a", 1, true, null, {}));
  attempt("s_stored call", () => f.call({ k: 1 }, "a"));
  attempt("s_stored length", () => [f.length, f.name]);
}
for (const line of await Promise.all(pending)) console.log(line);
