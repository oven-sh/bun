// Buffer.concat takes an array or a proxy of one. Of any other object the message says what it is: it reads `constructor` and, off that, `name`.
function told(f) { try { return String(f()); } catch (e) { return e.code + ": " + e.message; } }
const ran = [];
const literal = { __proto__: Object.prototype, other: 1 };
Object.defineProperty(literal, "constructor", { value: { get name() { ran.push("name"); return "Literal"; } }, writable: true, configurable: true });
console.log(told(() => Buffer.concat(literal)), ran.splice(0).join());
const namer = Object.defineProperty(function () {}, "name", { get() { ran.push("get"); return "Namer"; } });
console.log(told(() => Buffer.concat({ constructor: namer })), ran.splice(0).join());
class Listed { get length() { ran.push("length"); return 0; } }
console.log(told(() => Buffer.concat(new Listed())), ran.splice(0).join());
console.log(told(() => Buffer.concat(Object.create(null))), told(() => Buffer.concat(new Map())), told(() => Buffer.concat(new Uint8Array(2))));
console.log(told(() => Buffer.concat(5)), told(() => Buffer.concat("text")), told(() => Buffer.concat()), told(() => Buffer.concat(null)));

console.log(told(() => Buffer.concat([Buffer.from("a"), new Uint8Array([98])])), told(() => Buffer.concat([])), told(() => Buffer.concat([Buffer.from("abc")], 2)));
const seen = [];
const proxy = new Proxy([Buffer.from("p"), Buffer.from("q")], { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } });
console.log(told(() => Buffer.concat(proxy)), seen.join());
console.log(told(() => Buffer.concat(new Proxy({ length: 0 }, {}))));
const withGetter = [Buffer.from("x")];
Object.defineProperty(withGetter, 1, { get() { ran.push("element"); return Buffer.from("y"); } });
console.log(told(() => Buffer.concat(withGetter)), ran.splice(0).join());
console.log(told(() => Buffer.concat([{ constructor: { get name() { ran.push("element's name"); return "Element"; } } }])), ran.splice(0).join());
