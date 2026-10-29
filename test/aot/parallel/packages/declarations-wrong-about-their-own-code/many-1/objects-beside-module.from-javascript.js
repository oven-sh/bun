import * as L from "own_objects_1";
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
{ const f = L.o_fields;
  values().forEach((v, i) => attempt("o_fields " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_fields a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_fields 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_fields same " + i, () => f(v, v)));
  attempt("o_fields none", () => f());
  attempt("o_fields many", () => f("a", 1, true, null, {}));
  attempt("o_fields call", () => f.call({ k: 1 }, "a"));
  attempt("o_fields length", () => [f.length, f.name]);
}
{ const f = L.o_named;
  values().forEach((v, i) => attempt("o_named " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_named a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_named 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_named same " + i, () => f(v, v)));
  attempt("o_named none", () => f());
  attempt("o_named many", () => f("a", 1, true, null, {}));
  attempt("o_named call", () => f.call({ k: 1 }, "a"));
  attempt("o_named length", () => [f.length, f.name]);
}
{ const f = L.o_write;
  values().forEach((v, i) => attempt("o_write " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_write a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_write 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_write same " + i, () => f(v, v)));
  attempt("o_write none", () => f());
  attempt("o_write many", () => f("a", 1, true, null, {}));
  attempt("o_write call", () => f.call({ k: 1 }, "a"));
  attempt("o_write length", () => [f.length, f.name]);
}
{ const f = L.o_delete;
  values().forEach((v, i) => attempt("o_delete " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_delete a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_delete 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_delete same " + i, () => f(v, v)));
  attempt("o_delete none", () => f());
  attempt("o_delete many", () => f("a", 1, true, null, {}));
  attempt("o_delete call", () => f.call({ k: 1 }, "a"));
  attempt("o_delete length", () => [f.length, f.name]);
}
{ const f = L.o_method;
  values().forEach((v, i) => attempt("o_method " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_method a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_method 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_method same " + i, () => f(v, v)));
  attempt("o_method none", () => f());
  attempt("o_method many", () => f("a", 1, true, null, {}));
  attempt("o_method call", () => f.call({ k: 1 }, "a"));
  attempt("o_method length", () => [f.length, f.name]);
}
{ const f = L.o_nested;
  values().forEach((v, i) => attempt("o_nested " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_nested a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_nested 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_nested same " + i, () => f(v, v)));
  attempt("o_nested none", () => f());
  attempt("o_nested many", () => f("a", 1, true, null, {}));
  attempt("o_nested call", () => f.call({ k: 1 }, "a"));
  attempt("o_nested length", () => [f.length, f.name]);
}
{ const f = L.o_array;
  values().forEach((v, i) => attempt("o_array " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_array a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_array 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_array same " + i, () => f(v, v)));
  attempt("o_array none", () => f());
  attempt("o_array many", () => f("a", 1, true, null, {}));
  attempt("o_array call", () => f.call({ k: 1 }, "a"));
  attempt("o_array length", () => [f.length, f.name]);
}
{ const f = L.o_array_methods;
  values().forEach((v, i) => attempt("o_array_methods " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_array_methods a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_array_methods 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_array_methods same " + i, () => f(v, v)));
  attempt("o_array_methods none", () => f());
  attempt("o_array_methods many", () => f("a", 1, true, null, {}));
  attempt("o_array_methods call", () => f.call({ k: 1 }, "a"));
  attempt("o_array_methods length", () => [f.length, f.name]);
}
{ const f = L.o_array_push;
  values().forEach((v, i) => attempt("o_array_push " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_array_push a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_array_push 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_array_push same " + i, () => f(v, v)));
  attempt("o_array_push none", () => f());
  attempt("o_array_push many", () => f("a", 1, true, null, {}));
  attempt("o_array_push call", () => f.call({ k: 1 }, "a"));
  attempt("o_array_push length", () => [f.length, f.name]);
}
{ const f = L.o_for_of;
  values().forEach((v, i) => attempt("o_for_of " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_for_of a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_for_of 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_for_of same " + i, () => f(v, v)));
  attempt("o_for_of none", () => f());
  attempt("o_for_of many", () => f("a", 1, true, null, {}));
  attempt("o_for_of call", () => f.call({ k: 1 }, "a"));
  attempt("o_for_of length", () => [f.length, f.name]);
}
{ const f = L.o_tuple;
  values().forEach((v, i) => attempt("o_tuple " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_tuple a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_tuple 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_tuple same " + i, () => f(v, v)));
  attempt("o_tuple none", () => f());
  attempt("o_tuple many", () => f("a", 1, true, null, {}));
  attempt("o_tuple call", () => f.call({ k: 1 }, "a"));
  attempt("o_tuple length", () => [f.length, f.name]);
}
{ const f = L.o_callback;
  values().forEach((v, i) => attempt("o_callback " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_callback a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_callback 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_callback same " + i, () => f(v, v)));
  attempt("o_callback none", () => f());
  attempt("o_callback many", () => f("a", 1, true, null, {}));
  attempt("o_callback call", () => f.call({ k: 1 }, "a"));
  attempt("o_callback length", () => [f.length, f.name]);
}
{ const f = L.o_map;
  values().forEach((v, i) => attempt("o_map " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_map a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_map 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_map same " + i, () => f(v, v)));
  attempt("o_map none", () => f());
  attempt("o_map many", () => f("a", 1, true, null, {}));
  attempt("o_map call", () => f.call({ k: 1 }, "a"));
  attempt("o_map length", () => [f.length, f.name]);
}
{ const f = L.o_set;
  values().forEach((v, i) => attempt("o_set " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_set a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_set 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_set same " + i, () => f(v, v)));
  attempt("o_set none", () => f());
  attempt("o_set many", () => f("a", 1, true, null, {}));
  attempt("o_set call", () => f.call({ k: 1 }, "a"));
  attempt("o_set length", () => [f.length, f.name]);
}
{ const f = L.o_date;
  values().forEach((v, i) => attempt("o_date " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_date a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_date 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_date same " + i, () => f(v, v)));
  attempt("o_date none", () => f());
  attempt("o_date many", () => f("a", 1, true, null, {}));
  attempt("o_date call", () => f.call({ k: 1 }, "a"));
  attempt("o_date length", () => [f.length, f.name]);
}
{ const f = L.o_regexp;
  values().forEach((v, i) => attempt("o_regexp " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_regexp a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_regexp 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_regexp same " + i, () => f(v, v)));
  attempt("o_regexp none", () => f());
  attempt("o_regexp many", () => f("a", 1, true, null, {}));
  attempt("o_regexp call", () => f.call({ k: 1 }, "a"));
  attempt("o_regexp length", () => [f.length, f.name]);
}
{ const f = L.o_promise;
  values().forEach((v, i) => attempt("o_promise " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_promise a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_promise 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_promise same " + i, () => f(v, v)));
  attempt("o_promise none", () => f());
  attempt("o_promise many", () => f("a", 1, true, null, {}));
  attempt("o_promise call", () => f.call({ k: 1 }, "a"));
  attempt("o_promise length", () => [f.length, f.name]);
}
{ const f = L.o_url;
  values().forEach((v, i) => attempt("o_url " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_url a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_url 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_url same " + i, () => f(v, v)));
  attempt("o_url none", () => f());
  attempt("o_url many", () => f("a", 1, true, null, {}));
  attempt("o_url call", () => f.call({ k: 1 }, "a"));
  attempt("o_url length", () => [f.length, f.name]);
}
{ const f = L.o_request;
  values().forEach((v, i) => attempt("o_request " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_request a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_request 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_request same " + i, () => f(v, v)));
  attempt("o_request none", () => f());
  attempt("o_request many", () => f("a", 1, true, null, {}));
  attempt("o_request call", () => f.call({ k: 1 }, "a"));
  attempt("o_request length", () => [f.length, f.name]);
}
{ const f = L.o_bytes;
  values().forEach((v, i) => attempt("o_bytes " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_bytes a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_bytes 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_bytes same " + i, () => f(v, v)));
  attempt("o_bytes none", () => f());
  attempt("o_bytes many", () => f("a", 1, true, null, {}));
  attempt("o_bytes call", () => f.call({ k: 1 }, "a"));
  attempt("o_bytes length", () => [f.length, f.name]);
}
{ const f = L.o_record;
  values().forEach((v, i) => attempt("o_record " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_record a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_record 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_record same " + i, () => f(v, v)));
  attempt("o_record none", () => f());
  attempt("o_record many", () => f("a", 1, true, null, {}));
  attempt("o_record call", () => f.call({ k: 1 }, "a"));
  attempt("o_record length", () => [f.length, f.name]);
}
{ const f = L.o_object;
  values().forEach((v, i) => attempt("o_object " + i, () => f(v)));
  values().forEach((v, i) => attempt("o_object a," + i, () => f("a", v)));
  values().forEach((v, i) => attempt("o_object 1," + i, () => f(1, v)));
  values().forEach((v, i) => attempt("o_object same " + i, () => f(v, v)));
  attempt("o_object none", () => f());
  attempt("o_object many", () => f("a", 1, true, null, {}));
  attempt("o_object call", () => f.call({ k: 1 }, "a"));
  attempt("o_object length", () => [f.length, f.name]);
}
for (const line of await Promise.all(pending)) console.log(line);
