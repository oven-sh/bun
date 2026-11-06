// @ts-nocheck
import * as M from "own_signatures_3";
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
{ const f = L.g_overloads;
  values().forEach((v, i) => attempt("g_overloads " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_overloads a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_overloads 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_overloads same " + i, () => f(v, v)));
  attempt("g_overloads none", () => f());
  attempt("g_overloads many", () => f("a", 1, true, null, {}));
  attempt("g_overloads call", () => f.call({ k: 1 }, "a"));
  attempt("g_overloads length", () => [f.length, f.name]);
}
{ const f = L.g_overload_lengths;
  values().forEach((v, i) => attempt("g_overload_lengths " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_overload_lengths a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_overload_lengths 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_overload_lengths same " + i, () => f(v, v)));
  attempt("g_overload_lengths none", () => f());
  attempt("g_overload_lengths many", () => f("a", 1, true, null, {}));
  attempt("g_overload_lengths call", () => f.call({ k: 1 }, "a"));
  attempt("g_overload_lengths length", () => [f.length, f.name]);
}
{ const f = L.g_generic;
  values().forEach((v, i) => attempt("g_generic " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_generic a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_generic 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_generic same " + i, () => f(v, v)));
  attempt("g_generic none", () => f());
  attempt("g_generic many", () => f("a", 1, true, null, {}));
  attempt("g_generic call", () => f.call({ k: 1 }, "a"));
  attempt("g_generic length", () => [f.length, f.name]);
}
{ const f = L.g_constrained;
  values().forEach((v, i) => attempt("g_constrained " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_constrained a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_constrained 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_constrained same " + i, () => f(v, v)));
  attempt("g_constrained none", () => f());
  attempt("g_constrained many", () => f("a", 1, true, null, {}));
  attempt("g_constrained call", () => f.call({ k: 1 }, "a"));
  attempt("g_constrained length", () => [f.length, f.name]);
}
{ const f = L.g_keyof;
  values().forEach((v, i) => attempt("g_keyof " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_keyof a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_keyof 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_keyof same " + i, () => f(v, v)));
  attempt("g_keyof none", () => f());
  attempt("g_keyof many", () => f("a", 1, true, null, {}));
  attempt("g_keyof call", () => f.call({ k: 1 }, "a"));
  attempt("g_keyof length", () => [f.length, f.name]);
}
{ const f = L.g_any;
  values().forEach((v, i) => attempt("g_any " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_any a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_any 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_any same " + i, () => f(v, v)));
  attempt("g_any none", () => f());
  attempt("g_any many", () => f("a", 1, true, null, {}));
  attempt("g_any call", () => f.call({ k: 1 }, "a"));
  attempt("g_any length", () => [f.length, f.name]);
}
{ const f = L.g_unknown;
  values().forEach((v, i) => attempt("g_unknown " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_unknown a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_unknown 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_unknown same " + i, () => f(v, v)));
  attempt("g_unknown none", () => f());
  attempt("g_unknown many", () => f("a", 1, true, null, {}));
  attempt("g_unknown call", () => f.call({ k: 1 }, "a"));
  attempt("g_unknown length", () => [f.length, f.name]);
}
{ const f = L.g_never;
  values().forEach((v, i) => attempt("g_never " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_never a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_never 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_never same " + i, () => f(v, v)));
  attempt("g_never none", () => f());
  attempt("g_never many", () => f("a", 1, true, null, {}));
  attempt("g_never call", () => f.call({ k: 1 }, "a"));
  attempt("g_never length", () => [f.length, f.name]);
}
{ const f = L.g_void;
  values().forEach((v, i) => attempt("g_void " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_void a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_void 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_void same " + i, () => f(v, v)));
  attempt("g_void none", () => f());
  attempt("g_void many", () => f("a", 1, true, null, {}));
  attempt("g_void call", () => f.call({ k: 1 }, "a"));
  attempt("g_void length", () => [f.length, f.name]);
}
{ const f = L.g_union;
  values().forEach((v, i) => attempt("g_union " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_union a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_union 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_union same " + i, () => f(v, v)));
  attempt("g_union none", () => f());
  attempt("g_union many", () => f("a", 1, true, null, {}));
  attempt("g_union call", () => f.call({ k: 1 }, "a"));
  attempt("g_union length", () => [f.length, f.name]);
}
{ const f = L.g_conditional;
  values().forEach((v, i) => attempt("g_conditional " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_conditional a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_conditional 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_conditional same " + i, () => f(v, v)));
  attempt("g_conditional none", () => f());
  attempt("g_conditional many", () => f("a", 1, true, null, {}));
  attempt("g_conditional call", () => f.call({ k: 1 }, "a"));
  attempt("g_conditional length", () => [f.length, f.name]);
}
{ const f = L.g_const_arrow;
  values().forEach((v, i) => attempt("g_const_arrow " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_const_arrow a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_const_arrow 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_const_arrow same " + i, () => f(v, v)));
  attempt("g_const_arrow none", () => f());
  attempt("g_const_arrow many", () => f("a", 1, true, null, {}));
  attempt("g_const_arrow call", () => f.call({ k: 1 }, "a"));
  attempt("g_const_arrow length", () => [f.length, f.name]);
}
{ const f = L.g_const_is_function;
  values().forEach((v, i) => attempt("g_const_is_function " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_const_is_function a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_const_is_function 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_const_is_function same " + i, () => f(v, v)));
  attempt("g_const_is_function none", () => f());
  attempt("g_const_is_function many", () => f("a", 1, true, null, {}));
  attempt("g_const_is_function call", () => f.call({ k: 1 }, "a"));
  attempt("g_const_is_function length", () => [f.length, f.name]);
}
{ const f = L.g_function_is_const;
  values().forEach((v, i) => attempt("g_function_is_const " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_function_is_const a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_function_is_const 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_function_is_const same " + i, () => f(v, v)));
  attempt("g_function_is_const none", () => f());
  attempt("g_function_is_const many", () => f("a", 1, true, null, {}));
  attempt("g_function_is_const call", () => f.call({ k: 1 }, "a"));
  attempt("g_function_is_const length", () => [f.length, f.name]);
}
{ const f = L.g_function_is_class;
  values().forEach((v, i) => attempt("g_function_is_class " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_function_is_class a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_function_is_class 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_function_is_class same " + i, () => f(v, v)));
  attempt("g_function_is_class none", () => f());
  attempt("g_function_is_class many", () => f("a", 1, true, null, {}));
  attempt("g_function_is_class call", () => f.call({ k: 1 }, "a"));
  attempt("g_function_is_class length", () => [f.length, f.name]);
}
{ const f = L.g_interface_call;
  values().forEach((v, i) => attempt("g_interface_call " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_interface_call a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_interface_call 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_interface_call same " + i, () => f(v, v)));
  attempt("g_interface_call none", () => f());
  attempt("g_interface_call many", () => f("a", 1, true, null, {}));
  attempt("g_interface_call call", () => f.call({ k: 1 }, "a"));
  attempt("g_interface_call length", () => [f.length, f.name]);
}
{ const f = L.g_async;
  values().forEach((v, i) => attempt("g_async " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_async a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_async 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_async same " + i, () => f(v, v)));
  attempt("g_async none", () => f());
  attempt("g_async many", () => f("a", 1, true, null, {}));
  attempt("g_async call", () => f.call({ k: 1 }, "a"));
  attempt("g_async length", () => [f.length, f.name]);
}
{ const f = L.g_generator;
  values().forEach((v, i) => attempt("g_generator " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_generator a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_generator 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_generator same " + i, () => f(v, v)));
  attempt("g_generator none", () => f());
  attempt("g_generator many", () => f("a", 1, true, null, {}));
  attempt("g_generator call", () => f.call({ k: 1 }, "a"));
  attempt("g_generator length", () => [f.length, f.name]);
}
{ const f = L.g_result;
  values().forEach((v, i) => attempt("g_result " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_result a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_result 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_result same " + i, () => f(v, v)));
  attempt("g_result none", () => f());
  attempt("g_result many", () => f("a", 1, true, null, {}));
  attempt("g_result call", () => f.call({ k: 1 }, "a"));
  attempt("g_result length", () => [f.length, f.name]);
}
{ const f = L.g_inner_caller;
  values().forEach((v, i) => attempt("g_inner_caller " + i, () => f(v)));
  values().forEach((v, i) => attempt("g_inner_caller a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("g_inner_caller 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("g_inner_caller same " + i, () => f(v, v)));
  attempt("g_inner_caller none", () => f());
  attempt("g_inner_caller many", () => f("a", 1, true, null, {}));
  attempt("g_inner_caller call", () => f.call({ k: 1 }, "a"));
  attempt("g_inner_caller length", () => [f.length, f.name]);
}
for (const line of await Promise.all(pending)) console.log(line);
