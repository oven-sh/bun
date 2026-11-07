// `for (const [key, value] of Object.entries(object))`: the loop alone has the list of pairs, so compiled code asks for the keys and values in one
// list and makes no pair. What the listing does, when it does it and what the body may do to the object stay as the language says.
const log = [];
const show = value => (typeof value === "symbol" ? String(value) : typeof value === "function" ? "function" : JSON.stringify(value));

function walk(object) {
  const seen = [];
  for (const [key, value] of Object.entries(object)) seen.push(key + "=" + show(value));
  return seen.join();
}
function report(title, run) {
  let result;
  try {
    result = run();
  } catch (error) {
    result = "threw " + error.name + ": " + String(error.message).replace(/ \(evaluating .*$/, "");
  }
  console.log(title + ": " + result + (log.length ? " | " + log.splice(0).join() : ""));
}

report("a literal", () => walk({ a: 1, b: "x", c: null, d: undefined, e: [1], f: { g: 1 } }));
report("nothing", () => walk({}));
report("index keys come first, in order", () => walk({ b: 1, 2: "two", a: 2, 0: "zero", 10: "ten", "-1": "no index", "01": "no index" }));
report("symbols are left out", () => walk({ a: 1, [Symbol("s")]: 2, [Symbol.iterator]: 3, b: 4 }));
report("what cannot be enumerated is left out", () => {
  const object = Object.defineProperties({ a: 1 }, { hidden: { value: 2, enumerable: false }, shown: { value: 3, enumerable: true } });
  return walk(object);
});
report("what is inherited is left out", () => walk(Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } })));
report("no prototype", () => walk(Object.assign(Object.create(null), { a: 1, b: 2 })));
report("an array", () => walk(["a", , "c"]));
report("an array with a name", () => walk(Object.assign(["a"], { name: "n" })));
report("a string", () => walk("ab"));
report("a number", () => walk(7));
report("a boolean", () => walk(true));
report("a symbol", () => walk(Symbol("s")));
report("a bigint", () => walk(7n));
report("a function", () => walk(Object.assign(function named() {}, { extra: 1 })));
report("a class with statics", () => walk(class { static a = 1; static b() {} }));
report("an instance", () => walk(new (class { x = 1; #hidden = 2; y = 2; method() {} get z() { return 3; } })()));
report("a Map", () => walk(new Map([[1, 2]])));
report("a typed array", () => walk(new Uint8Array([5, 6])));
report("parsed text", () => walk(JSON.parse('{"p":1,"q":[2],"r":{"s":3},"1":"one"}')));
report("undefined", () => walk(undefined));
report("null", () => walk(null));
report("no operand", () => { for (const [key] of Object.entries()) log.push(key); return "done"; });
report("two operands", () => { const seen = []; for (const [key] of Object.entries({ a: 1 }, { b: 2 })) seen.push(key); return seen.join(); });

report("getters run while the object is listed, before the body", () => {
  const object = { get a() { log.push("get a"); return 1; }, b: 2, get c() { log.push("get c"); return 3; } };
  const seen = [];
  for (const [key, value] of Object.entries(object)) { log.push("body " + key); seen.push(key + value); }
  return seen.join();
});
report("a getter deletes a later key", () => walk({ get a() { delete this.b; return 1; }, b: 2, c: 3 }));
report("a getter adds a key", () => walk({ get a() { this.z = 26; return 1; }, b: 2 }));
report("a getter hides a later key", () => walk({ get a() { Object.defineProperty(this, "b", { enumerable: false }); return 1; }, b: 2, c: 3 }));
report("a getter changes a later value", () => walk({ get a() { this.b = "changed"; return 1; }, b: 2 }));
report("a getter throws", () => walk({ a: 1, get b() { log.push("get b"); throw new RangeError("from the getter"); }, get c() { log.push("get c"); return 3; } }));
report("a setter alone", () => walk({ set a(value) { log.push("set"); }, b: 1 }));

report("the traps of a Proxy, in order", () => {
  const proxy = new Proxy({ a: 1, b: 2, [Symbol("s")]: 3 }, {
    ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); },
    has(target, key) { log.push("has " + String(key)); return Reflect.has(target, key); },
  });
  const seen = [];
  for (const [key, value] of Object.entries(proxy)) { log.push("body " + key); seen.push(key + value); }
  return seen.join();
});
report("a Proxy that hides a key", () => walk(new Proxy({ a: 1, b: 2 }, { getOwnPropertyDescriptor: (target, key) => (key === "a" ? undefined : Reflect.getOwnPropertyDescriptor(target, key)) })));
report("a Proxy whose trap throws", () => walk(new Proxy({ a: 1 }, { ownKeys() { throw new SyntaxError("from the trap"); } })));
report("a revoked Proxy", () => { const { proxy, revoke } = Proxy.revocable({ a: 1 }, {}); revoke(); return walk(proxy); });

report("the body deletes a later key", () => {
  const object = { a: 1, b: 2, c: 3 }, seen = [];
  for (const [key, value] of Object.entries(object)) { delete object.b; delete object.c; seen.push(key + value); }
  return seen.join() + " then " + Object.keys(object).join();
});
report("the body adds keys", () => {
  const object = { a: 1, b: 2 }, seen = [];
  for (const [key, value] of Object.entries(object)) { object[key + key] = value * 2; seen.push(key + value); }
  return seen.join() + " then " + Object.keys(object).join();
});
report("the body changes later values", () => {
  const object = { a: 1, b: 2 }, seen = [];
  for (const [key, value] of Object.entries(object)) { object.b = "changed"; seen.push(key + value); }
  return seen.join();
});
report("break", () => { const seen = []; for (const [key, value] of Object.entries({ a: 1, b: 2, c: 3 })) { if (key === "b") break; seen.push(key + value); } return seen.join(); });
report("continue", () => { const seen = []; for (const [key, value] of Object.entries({ a: 1, b: 2, c: 3 })) { if (key === "b") continue; seen.push(key + value); } return seen.join(); });
report("return", () => { for (const [key, value] of Object.entries({ a: 1, b: 2, c: 3 })) if (value === 2) return key; return "none"; });
report("the body throws", () => { for (const [key] of Object.entries({ a: 1, b: 2 })) { log.push(key); if (key === "b") throw new EvalError("from the body"); } });
report("the body throws and is caught inside", () => {
  const seen = [];
  for (const [key] of Object.entries({ a: 1, b: 2, c: 3 })) { try { if (key === "b") throw new Error("b"); seen.push(key); } catch (error) { seen.push("caught " + error.message); } finally { seen.push("finally"); } }
  return seen.join();
});
report("a label", () => { const seen = []; outer: for (const [key] of Object.entries({ a: 1, b: 2 })) for (const [inner] of Object.entries({ x: 1, y: 2 })) { if (inner === "y") continue outer; seen.push(key + inner); } return seen.join(); });

report("the key alone", () => { const seen = []; for (const [key] of Object.entries({ a: 1, b: 2 })) seen.push(key); return seen.join(); });
report("the value alone", () => { const seen = []; for (const [, value] of Object.entries({ a: 1, b: 2 })) seen.push(value); return seen.join(); });
report("a third element", () => { const seen = []; for (const [key, value, third] of Object.entries({ a: 1 })) seen.push(key, value, third); return seen.join(); });
report("a rest element", () => { const seen = []; for (const [key, ...rest] of Object.entries({ a: 1, b: 2 })) seen.push(key + rest.length + rest[0]); return seen.join(); });
report("defaults", () => { const seen = []; for (const [key = "k", value = "default"] of Object.entries({ a: undefined, b: null })) seen.push(key + value); return seen.join(); });
report("a nested pattern", () => { const seen = []; for (const [key, { x, y = 9 }] of Object.entries({ a: { x: 1 }, b: { x: 2, y: 3 } })) seen.push(key + x + y); return seen.join(); });
report("a nested pattern of nothing", () => { for (const [key, { x }] of Object.entries({ a: { x: 1 }, b: undefined })) log.push(key + x); });
report("targets that exist", () => { let key, holder = {}; const seen = []; for ([key, holder.value] of Object.entries({ a: 1, b: 2 })) seen.push(key + holder.value); return seen.join(); });
report("var", () => { const seen = []; for (var [key, value] of Object.entries({ a: 1, b: 2 })) seen.push(key + value); return seen.join() + key + value; });
report("closures keep their own pair", () => { const later = []; for (const [key, value] of Object.entries({ a: 1, b: 2 })) later.push(() => key + value); return later.map(one => one()).join(); });

report("the pair itself", () => {
  const pairs = [];
  for (const pair of Object.entries({ a: 1, b: 2 })) pairs.push(pair);
  return JSON.stringify(pairs) + pairs.every(pair => Array.isArray(pair) && pair.length === 2 && Object.getPrototypeOf(pair) === Array.prototype) + (pairs[0] !== pairs[1]);
});
report("the pair is changed", () => { const seen = []; for (const pair of Object.entries({ a: 1, b: 2 })) { pair.push("more"); pair[0] += "!"; seen.push(pair.join("/")); } return seen.join(); });
report("the pair and its parts", () => { const seen = []; for (const pair of Object.entries({ a: 1 })) { const [key, value] = pair; seen.push(key, value, pair.length); } return seen.join(); });
report("the list has another reader", () => {
  const list = Object.entries({ a: 1, b: 2 }), seen = [];
  for (const [key, value] of list) { if (list.length === 2) list.push(["late", 3]); seen.push(key + value); }
  return seen.join() + list.length;
});
report("the list is kept", () => { let kept; const seen = []; for (const [key] of (kept = Object.entries({ a: 1 }))) seen.push(key); return seen.join() + JSON.stringify(kept); });
report("something runs between the listing and the loop", () => {
  const object = { a: 1 };
  const list = Object.entries(object);
  object.b = 2;
  const seen = [];
  for (const [key] of list) seen.push(key);
  return seen.join();
});
report("the operand has effects", () => { const seen = []; for (const [key] of Object.entries((log.push("operand"), { a: 1 }))) seen.push(key); return seen.join(); });
report("many keys", () => {
  const object = {};
  for (let index = 0; index < 300; index++) object["k" + index] = index;
  let sum = 0, names = 0;
  for (const [key, value] of Object.entries(object)) { sum += value; names += key.length; }
  return sum + "/" + names;
});
report("keys are strings of their own", () => { const seen = []; for (const [key] of Object.entries({ 1: "a", b: 2 })) seen.push(typeof key + key.length); return seen.join(); });
report("another function under the name", () => {
  const Objects = { entries: object => [["made", "up"]] };
  const seen = [];
  for (const [key, value] of Objects.entries({ a: 1 })) seen.push(key + value);
  return seen.join();
});
report("in a generator", () => {
  function* pairs(object) { for (const [key, value] of Object.entries(object)) yield key + value; }
  const generator = pairs({ a: 1, b: 2, c: 3 });
  return [generator.next().value, generator.return("stop").value, generator.next().done].join();
});
await (async () => {
  const seen = [];
  for (const [key, value] of Object.entries({ a: 1, b: 2 })) { await null; seen.push(key + value); }
  console.log("across await: " + seen.join());
})();
for (let round = 0; round < 3; round++) {
  const shapes = [{ a: 1, b: "x" }, { style: { x: 1 }, children: "t", key: 4 }, JSON.parse('{"p":1,"q":2}'), Object.assign({ a: 1 }, { ["added" + round]: round }), []];
  console.log("round " + round + ": " + shapes.map(walk).join(" ; "));
}
