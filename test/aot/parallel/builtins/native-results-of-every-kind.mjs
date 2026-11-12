// Calls of native functions whose results are booleans, texts, symbols, objects and lists, on receivers and arguments that the stubs answer themselves and on ones that they leave to the native function; the results are used at once, held, returned and dropped.
const lines = [];
const show = value => (typeof value === "symbol" ? value.toString() : typeof value === "bigint" ? value + "n" : value === undefined ? "undefined" : typeof value === "function" ? "function " + value.name : JSON.stringify(value));
const note = (name, call) => {
  let given;
  try { given = show(call()); } catch (error) { given = `${error.constructor.name}: ${error.message}`; }
  lines.push(`${name} ${given}`);
};
class List extends Array { join(...rest) { return "L" + super.join(...rest); } }
class Pattern extends RegExp { exec(text) { const found = super.exec(text); if (found) found.extra = 1; return found; } }
const values = [1, -0, 1.5, "text", "", "wide \u{1F600}", true, null, undefined, 12n, Symbol("own"), [1, 2], [], new List(1, 2, 3), {}, { length: 2, 0: "a", 1: "b" }, new Proxy([7], {}), new Proxy({}, {}), new Map([[1, 2]]), new Set([1]), new WeakMap(), /t./g, new Pattern("e"), new Date(0), function named() {}, new Uint8Array(2), Object.create(null), { toString() { return "own text"; } }];

values.forEach((value, index) => {
  note(`isArray ${index}`, () => Array.isArray(value));
  note(`not isArray ${index}`, () => (Array.isArray(value) ? 0 : 1));
  note(`isNaN ${index}`, () => isNaN(value));
  note(`Object.is ${index}`, () => Object.is(value, values[0]) || Object.is(value, value));
  note(`hasOwn ${index}`, () => Object.prototype.hasOwnProperty.call(value, "length") && "has");
  note(`includes ${index}`, () => Array.prototype.includes.call(value, "a") + "/" + [1, "text", NaN, undefined].includes(value));
  note(`test ${index}`, () => /t/.test(value) + "/" + new Pattern("t").test(value));
  note(`sticky ${index}`, () => { const r = /t/y; return [r.test(value), r.lastIndex, r.test(value), r.lastIndex]; });
  note(`String ${index}`, () => String(value) + "|" + `${String(value)}`.length);
  note(`join ${index}`, () => Array.prototype.join.call(value, "-") + "/" + [value, value].join());
  note(`symbol ${index}`, () => Symbol.for(value) === Symbol.for(value) && Symbol.keyFor(Symbol.for(value)));
  note(`keys ${index}`, () => Object.keys(value).concat(Object.entries(value).map(([key]) => key)));
  note(`assign ${index}`, () => Object.keys(Object.assign({ z: 1 }, value)));
  note(`freeze ${index}`, () => Object.isFrozen(Object.freeze({ value: 1 })) + "/" + (typeof Object.freeze(value === values[21] || value === values[25] ? {} : value)));
  note(`prototype ${index}`, () => Object.getPrototypeOf(value) === Object.getPrototypeOf(Object(value)));
  note(`create ${index}`, () => Object.keys(Object.create(value === undefined ? null : value, { q: { value: 1, enumerable: true } })));
  note(`from ${index}`, () => Array.from(value).length);
  note(`of ${index}`, () => Array.of(value, 1).length);
  note(`parse ${index}`, () => JSON.parse(JSON.stringify([value === values[9] || value === values[10] ? 0 : value]))[0]);
  note(`encode ${index}`, () => encodeURIComponent(value) + decodeURI(encodeURI(value)));
  note(`starts ${index}`, () => ["text".startsWith(value), "text".endsWith(value), "text".includes(value)]);
  note(`slice ${index}`, () => "abcdef".slice(value) + "/" + "abcdef".substring(value, 4) + "/" + "abcdef".substr(value, 2) + "/" + "abcdef".charAt(value));
  note(`cases ${index}`, () => String.prototype.toUpperCase.call(value) + String.prototype.toLowerCase.call(value) + String.prototype.trim.call(value) + String.prototype.trimStart.call(value) + String.prototype.trimEnd.call(value));
  note(`slice of ${index}`, () => Array.prototype.slice.call(value, 0, 1));
  note(`tables ${index}`, () => [new Map([[value, 1]]).has(value), new Set([value]).has(value), new Map().delete(value), new Set([value]).delete(value)]);
  note(`weak ${index}`, () => [values[20].has(value), new WeakSet().has(value), values[20].get(value)]);
  note(`map ${index}`, () => Map.prototype.has.call(value, 1));
  note(`set ${index}`, () => Set.prototype.has.call(value, 1));
  note(`string ${index}`, () => String.prototype.includes.call(value, "e") + "/" + String.prototype.slice.call(value, 1));
  note(`raw ${index}`, () => String.fromCharCode(value).length + String.raw({ raw: ["a", "b"] }, value).length);
  note(`toString ${index}`, () => Object.prototype.toString.call(value));
  note(`bytes ${index}`, () => Buffer.from(typeof value === "string" ? value : "b").toString(index % 2 ? "utf8" : "hex"));
});

// The same in turns of loops, and with results that nothing reads.
let booleans = 0, texts = "";
for (let turn = 0; turn < 3000; turn++) {
  const value = values[turn % values.length];
  Array.isArray(value);
  if (Array.isArray(value)) booleans++;
  if (/e/.test("text" + turn)) booleans += 2;
  if ([1, 2, turn].includes(turn)) booleans += 4;
  if (turn % 7 === 0) texts += String(turn).slice(-1) + [turn, "x"].join("");
  texts = texts.slice(-40);
}
note("turns", () => [booleans, texts]);

const held = { isArray: Array.isArray, test: RegExp.prototype.test, has: Map.prototype.has, join: Array.prototype.join, slice: String.prototype.slice, symbol: Symbol.for };
note("held", () => [held.isArray([1]), held.isArray({}), held.test.call(/x/, "x"), held.has.call(new Map([[1, 1]]), 1), held.join.call([1, 2], "+"), held.slice.call("abc", 1), held.symbol("s") === Symbol.for("s")]);
note("bound", () => [1, [1], "x", new Proxy([], {})].map(Array.isArray));
note("filter", () => ["a", "bt", "t"].filter(RegExp.prototype.test, /t/));
note("tail", () => (function isList(x) { return Array.isArray(x); })(new Proxy([], {})));
const revoked = Proxy.revocable([], {});
revoked.revoke();
note("revoked", () => Array.isArray(revoked.proxy));
const changed = /a/;
changed.exec = () => ({ found: true });
note("own exec", () => changed.test("nothing"));
note("wrong exec", () => { const pattern = /a/; pattern.exec = () => 5; return pattern.test("a"); });
note("throwing exec", () => { const pattern = /a/; pattern.exec = () => { throw new TypeError("own"); }; return pattern.test("a"); });
note("flags", () => { const pattern = /a/g; pattern.lastIndex = { valueOf() { return 1; } }; return [pattern.test("ba"), pattern.lastIndex]; });
console.log(lines.join("\n"));
