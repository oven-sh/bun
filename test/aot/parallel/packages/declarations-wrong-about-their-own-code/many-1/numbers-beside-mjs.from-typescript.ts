// @ts-nocheck
import * as M from "own_numbers_2";
const L: Record<string, any> = M;
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
{ const f = L.n_add;
  values().forEach((v, i) => attempt("n_add " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_add a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_add 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_add same " + i, () => f(v, v)));
  attempt("n_add none", () => f());
  attempt("n_add many", () => f("a", 1, true, null, {}));
  attempt("n_add call", () => f.call({ k: 1 }, "a"));
  attempt("n_add length", () => [f.length, f.name]);
}
{ const f = L.n_multiply;
  values().forEach((v, i) => attempt("n_multiply " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_multiply a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_multiply 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_multiply same " + i, () => f(v, v)));
  attempt("n_multiply none", () => f());
  attempt("n_multiply many", () => f("a", 1, true, null, {}));
  attempt("n_multiply call", () => f.call({ k: 1 }, "a"));
  attempt("n_multiply length", () => [f.length, f.name]);
}
{ const f = L.n_bits;
  values().forEach((v, i) => attempt("n_bits " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_bits a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_bits 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_bits same " + i, () => f(v, v)));
  attempt("n_bits none", () => f());
  attempt("n_bits many", () => f("a", 1, true, null, {}));
  attempt("n_bits call", () => f.call({ k: 1 }, "a"));
  attempt("n_bits length", () => [f.length, f.name]);
}
{ const f = L.n_compare;
  values().forEach((v, i) => attempt("n_compare " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_compare a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_compare 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_compare same " + i, () => f(v, v)));
  attempt("n_compare none", () => f());
  attempt("n_compare many", () => f("a", 1, true, null, {}));
  attempt("n_compare call", () => f.call({ k: 1 }, "a"));
  attempt("n_compare length", () => [f.length, f.name]);
}
{ const f = L.n_index;
  values().forEach((v, i) => attempt("n_index " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_index a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_index 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_index same " + i, () => f(v, v)));
  attempt("n_index none", () => f());
  attempt("n_index many", () => f("a", 1, true, null, {}));
  attempt("n_index call", () => f.call({ k: 1 }, "a"));
  attempt("n_index length", () => [f.length, f.name]);
}
{ const f = L.n_increment;
  values().forEach((v, i) => attempt("n_increment " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_increment a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_increment 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_increment same " + i, () => f(v, v)));
  attempt("n_increment none", () => f());
  attempt("n_increment many", () => f("a", 1, true, null, {}));
  attempt("n_increment call", () => f.call({ k: 1 }, "a"));
  attempt("n_increment length", () => [f.length, f.name]);
}
{ const f = L.n_negate;
  values().forEach((v, i) => attempt("n_negate " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_negate a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_negate 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_negate same " + i, () => f(v, v)));
  attempt("n_negate none", () => f());
  attempt("n_negate many", () => f("a", 1, true, null, {}));
  attempt("n_negate call", () => f.call({ k: 1 }, "a"));
  attempt("n_negate length", () => [f.length, f.name]);
}
{ const f = L.n_fixed;
  values().forEach((v, i) => attempt("n_fixed " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_fixed a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_fixed 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_fixed same " + i, () => f(v, v)));
  attempt("n_fixed none", () => f());
  attempt("n_fixed many", () => f("a", 1, true, null, {}));
  attempt("n_fixed call", () => f.call({ k: 1 }, "a"));
  attempt("n_fixed length", () => [f.length, f.name]);
}
{ const f = L.n_math;
  values().forEach((v, i) => attempt("n_math " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_math a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_math 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_math same " + i, () => f(v, v)));
  attempt("n_math none", () => f());
  attempt("n_math many", () => f("a", 1, true, null, {}));
  attempt("n_math call", () => f.call({ k: 1 }, "a"));
  attempt("n_math length", () => [f.length, f.name]);
}
{ const f = L.n_loop;
  values().forEach((v, i) => attempt("n_loop " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_loop a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_loop 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_loop same " + i, () => f(v, v)));
  attempt("n_loop none", () => f());
  attempt("n_loop many", () => f("a", 1, true, null, {}));
  attempt("n_loop call", () => f.call({ k: 1 }, "a"));
  attempt("n_loop length", () => [f.length, f.name]);
}
{ const f = L.n_literal;
  values().forEach((v, i) => attempt("n_literal " + i, () => f(v)));
  values().forEach((v, i) => attempt("n_literal a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("n_literal 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("n_literal same " + i, () => f(v, v)));
  attempt("n_literal none", () => f());
  attempt("n_literal many", () => f("a", 1, true, null, {}));
  attempt("n_literal call", () => f.call({ k: 1 }, "a"));
  attempt("n_literal length", () => [f.length, f.name]);
}
{ const f = L.b_not;
  values().forEach((v, i) => attempt("b_not " + i, () => f(v)));
  values().forEach((v, i) => attempt("b_not a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("b_not 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("b_not same " + i, () => f(v, v)));
  attempt("b_not none", () => f());
  attempt("b_not many", () => f("a", 1, true, null, {}));
  attempt("b_not call", () => f.call({ k: 1 }, "a"));
  attempt("b_not length", () => [f.length, f.name]);
}
{ const f = L.b_true;
  values().forEach((v, i) => attempt("b_true " + i, () => f(v)));
  values().forEach((v, i) => attempt("b_true a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("b_true 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("b_true same " + i, () => f(v, v)));
  attempt("b_true none", () => f());
  attempt("b_true many", () => f("a", 1, true, null, {}));
  attempt("b_true call", () => f.call({ k: 1 }, "a"));
  attempt("b_true length", () => [f.length, f.name]);
}
{ const f = L.big_add;
  values().forEach((v, i) => attempt("big_add " + i, () => f(v)));
  values().forEach((v, i) => attempt("big_add a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("big_add 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("big_add same " + i, () => f(v, v)));
  attempt("big_add none", () => f());
  attempt("big_add many", () => f("a", 1, true, null, {}));
  attempt("big_add call", () => f.call({ k: 1 }, "a"));
  attempt("big_add length", () => [f.length, f.name]);
}
{ const f = L.sym_text;
  values().forEach((v, i) => attempt("sym_text " + i, () => f(v)));
  values().forEach((v, i) => attempt("sym_text a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("sym_text 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("sym_text same " + i, () => f(v, v)));
  attempt("sym_text none", () => f());
  attempt("sym_text many", () => f("a", 1, true, null, {}));
  attempt("sym_text call", () => f.call({ k: 1 }, "a"));
  attempt("sym_text length", () => [f.length, f.name]);
}
{ const f = L.nil_only;
  values().forEach((v, i) => attempt("nil_only " + i, () => f(v)));
  values().forEach((v, i) => attempt("nil_only a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("nil_only 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("nil_only same " + i, () => f(v, v)));
  attempt("nil_only none", () => f());
  attempt("nil_only many", () => f("a", 1, true, null, {}));
  attempt("nil_only call", () => f.call({ k: 1 }, "a"));
  attempt("nil_only length", () => [f.length, f.name]);
}
for (const line of await Promise.all(pending)) console.log(line);
