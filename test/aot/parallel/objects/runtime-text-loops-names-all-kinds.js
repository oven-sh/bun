// for-in in text made at run time: parsed, written and constructed objects, names above, indexed properties, no names at all, objects that change inside the loop, loops left early, loops in loops, the same loop again and again.
const pad = process.argv.length > 99 ? " " : "";
const text = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1) + pad);
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
class Point3 extends Point { constructor() { super(1, 2); this.z = 3; } }
const NullObject = function () {};
NullObject.prototype = Object.create(null);
const names = text("o", "const out = []; for (const k in o) out.push(k); return out.join()");
const withAbove = Object.create({ above: 1, shadowed: 2 }); withAbove.own = 3; withAbove.shadowed = 4;
const hidden = Object.defineProperty({ seen: 1 }, "hidden", { value: 2, enumerable: false });
const dictionary = {}; for (let i = 0; i < 200; i++) dictionary["k" + i] = i; for (let i = 0; i < 190; i++) delete dictionary["k" + i];
const extra = new Point(1, 2); extra.more = 3; extra.evenMore = 4;
const params = new NullObject(); params.shop = 1; params.order = 2;
const objects = {
  parsed: JSON.parse('{"sku":"a","quantity":2,"unitCents":3}'), parsedOne: JSON.parse('{"a":1}'), parsedEmpty: JSON.parse("{}"), parsedMixed: JSON.parse('{"b":1,"2":2,"a":3,"1":4}'), parsedArray: JSON.parse("[5,6]"),
  literal: { a: 1, b: 2 }, empty: {}, point: new Point(1, 2), point3: new Point3(), extra, params, emptyNull: new NullObject(), createdNull: Object.create(null), withAbove, hidden, dictionary,
  array: [7, 8, 9], emptyArray: [], holes: [1, , 3], arrayWithName: Object.assign([1], { name: 2 }), string: "abc", emptyString: "", boxed: new String("xy"), number: 5, boolean: true, nothing: null, missing: undefined, symbolKeys: { [Symbol("s")]: 1, named: 2 },
  typed: new Uint8Array(2), map: new Map([[1, 2]]), fn: Object.assign(function () {}, { tag: 1 }), frozen: Object.freeze({ f: 1, g: 2 }), proxy: new Proxy({ p: 1, q: 2 }, {}), proxyKeys: new Proxy({}, { ownKeys: () => ["z", "y"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) }),
  args: (function () { return arguments; })(1, 2), date: new Date(0), error: Object.assign(new Error("e"), { code: 1 }), getter: { get g() { return 1; }, h: 2 },
};
for (let round = 0; round < 3; round++) for (const [name, object] of Object.entries(objects)) { const found = names(object); if (round === 2) console.log(name, "[" + found + "]"); }

const make = () => JSON.parse('{"a":1,"b":2,"c":3,"d":4}');
console.log(text("o", "const out = []; for (const k in o) { out.push(k); delete o.c; } return out.join()")(make()));
console.log(text("o", "const out = []; for (const k in o) { out.push(k); o.added = 1; } return out.join() + '|' + Object.keys(o).join()")(make()));
console.log(text("o", "const out = []; for (const k in o) { out.push(k); if (k === 'a') { delete o.b; o.b = 9; } } return out.join()")(make()));
console.log(text("o", "const out = []; for (const k in o) { out.push(k); if (k === 'd') o.e = 1; } return out.join()")(make()));
console.log(text("o", "const out = []; for (const k in o) { out.push(k); Object.setPrototypeOf(o, { late: 1 }); } return out.join()")(make()));
console.log(text("o", "const out = []; for (const k in o) { if (k === 'b') continue; if (k === 'd') break; out.push(k); } return out.join()")(make()));
console.log(text("o", "for (const k in o) { if (o[k] === 3) return k; } return 'none'")(make()));
console.log(text("o", "p", "const out = []; for (const k in o) for (const l in p) out.push(k + l); return out.join()")(make(), new Point(1, 2)));
console.log(text("o", "const out = []; for (const k in o) for (const l in o) if (k < l) out.push(k + l); return out.join()")(make()));
console.log(text("o", "let k = 'before'; for (k in o); return k")(make()), text("o", "let k = 'before'; for (k in o); return k")({}));
console.log(text("o", "const out = []; for (const k in o) { try { if (k === 'b') throw new Error(k); out.push(k); } catch (error) { out.push('caught ' + error.message); } } return out.join()")(make()));
console.log(text("o", "const out = []; for (const k in o) { out.push(k); delete o.x; delete o.y; } return out.join()")(new Point(1, 2)));
console.log(text("o", "const out = []; for (const k in o) { out.push(k); o.late = 1; } return out.join()")(new Point(1, 2)));
console.log(text("list", "let n = 0; for (let i = 0; i < 30000; i++) for (const k in list[i % list.length]) n += k.length; return n")([make(), new Point(1, 2), {}, [1, 2], params, withAbove, "ab"]));
console.log(text("data", "for (const key in data) { if (!(key === 'sku' || key === 'quantity' || key === 'unitCents')) return 'additional ' + key; } return 'valid'")(objects.parsed), text("data", "for (const key in data) { if (!(key === 'sku')) return 'additional ' + key; } return 'valid'")(objects.parsed));
