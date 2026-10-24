// A built-in that reads options, descriptors, traps, protocols or elements from an object finds what the object inherits from a literal that nothing else reads.
const rows = [];
function say(label, f) {
  try {
    rows.push(label + ": " + f());
  } catch (e) {
    rows.push(label + ": threw " + e.name);
  }
}
const heir = proto => Object.create(proto);
say("NumberFormat", () => new Intl.NumberFormat("en", heir({ style: "percent", minimumFractionDigits: 1 })).format(0.5));
say("toLocaleDateString", () => new Date(0).toLocaleDateString("en", heir({ timeZone: "UTC", year: "numeric" })));
say("toLocaleString", () => (1234.5).toLocaleString("en", heir({ maximumFractionDigits: 0 })));
say("localeCompare", () => "a".localeCompare("A", "en", heir({ sensitivity: "base" })));
say("Request", () => new Request("http://x/", heir({ method: "POST" })).method);
say("Response", () => new Response("x", heir({ status: 201, statusText: "made" })).status);
say("Headers", () => new Headers(heir({ a: "1" })).get("a"));
say("TextDecoder", () => new TextDecoder("utf-8", heir({ fatal: true })).fatal);
say("readFileSync", () => typeof require("node:fs").readFileSync(__filename, heir({ encoding: "utf8" })));
say("defineProperty", () => { const o = {}; Object.defineProperty(o, "k", heir({ value: 1, enumerable: true })); return JSON.stringify(o); });
say("defineProperties", () => JSON.stringify(Object.defineProperties({}, { k: heir({ value: 2, enumerable: true }) })));
say("Object.create descriptors", () => JSON.stringify(Object.create(null, { k: heir({ value: 3, enumerable: true }) })));
say("Reflect.defineProperty", () => { const o = {}; Reflect.defineProperty(o, "k", heir({ get() { return 4; }, enumerable: true })); return o.k; });
say("Proxy handler", () => new Proxy({}, heir({ get() { return "trapped"; } })).anything);
say("Array.from array-like", () => Array.from(heir({ length: 2, 0: "a", 1: "b" })).join());
say("join.call", () => Array.prototype.join.call(heir({ length: 2, 0: "x", 1: "y" })));
say("apply list", () => Math.max.apply(null, heir({ length: 2, 0: 3, 1: 9 })));
say("Reflect.apply list", () => Reflect.apply(Math.min, null, heir({ length: 2, 0: 3, 1: 9 })));
say("spread of inherited iterator", () => [...heir({ *[Symbol.iterator]() { yield 1; yield 2; } })].join());
say("Map of inherited iterator", () => new Map(heir({ *[Symbol.iterator]() { yield ["k", "v"]; } })).get("k"));
say("String", () => String(heir({ toString() { return "text"; } })));
say("template", () => `${heir({ toString() { return "templated"; } })}`);
say("Number", () => Number(heir({ valueOf() { return 4; } })));
say("toPrimitive", () => heir({ [Symbol.toPrimitive]() { return 6; } }) * 2);
say("toJSON", () => JSON.stringify(heir({ toJSON() { return 7; } })));
say("stringify replacer list", () => JSON.stringify({ a: 1, b: 2 }, heir({ length: 1, 0: "a" })));
say("replace", () => "abc".replace(heir({ [Symbol.replace]() { return "replaced"; } }), ""));
say("split", () => "abc".split(heir({ [Symbol.split]() { return "split"; } })));
say("instanceof", () => 1 instanceof heir({ [Symbol.hasInstance]() { return true; } }));
say("concat", () => [].concat(heir({ [Symbol.isConcatSpreadable]: true, length: 1, 0: "c" })).join());
say("Error cause", () => new Error("m", heir({ cause: 5 })).cause);
say("toStringTag", () => Object.prototype.toString.call(heir({ [Symbol.toStringTag]: "Tagged" })));
say("species", () => { class A extends Array {} const a = new A(1, 2); a.constructor = heir({ [Symbol.species]: Array }); return a.map(x => x) instanceof A; });
say("sort comparator result", () => [2, 1].sort(() => heir({ valueOf() { return 1; } })).join());
say("Object.assign source getter", () => JSON.stringify(Object.assign({}, heir({ hidden: 1 }))));
say("with unscopables", () => Object.keys(heir({ [Symbol.unscopables]: { x: true } })).length);
say("structuredClone options", () => structuredClone(1, heir({ transfer: [] })));
say("Intl.Segmenter", () => [...new Intl.Segmenter("en", heir({ granularity: "word" })).segment("a b")].length);
say("padStart filler", () => "1".padStart(3, heir({ toString() { return "0"; } })));
say("new Date", () => new Date(heir({ valueOf() { return 0; } })).getTime());
say("Symbol description", () => Symbol(heir({ toString() { return "described"; } })).description);
say("parseInt", () => parseInt(heir({ toString() { return "42"; } })));
say("Array length", () => { const a = []; a.length = heir({ valueOf() { return 2; } }); return a.length; });
say("key", () => ({ named: 1 })[heir({ toString() { return "named"; } })]);
rows.push("thenable: " + (await Promise.resolve(heir({ then(resolve) { resolve(5); } }))));
rows.push("await thenable: " + (await heir({ then(resolve) { resolve(6); } })));
rows.push("all: " + (await Promise.all(heir({ *[Symbol.iterator]() { yield 8; } }))).join());
console.log(rows.join("\n"));
