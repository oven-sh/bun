// A parameter `options = {}` of a file without types is expected to be what its use says: the literal with the names. Whatever is handed: that literal, the default, another literal, what was parsed,
// an instance, an object above the literal, one without a prototype, a proxy, getters, frozen and sealed ones, a name gained, deleted, hidden or turned into a getter behind the birth, primitives, null:
// each read answers as plain Bun's; the default is a new object at every call and takes stores like any.
"use strict";
const log = [];
function shape(width, options = {}) { const label = options.label === undefined ? "" : options.label; return width + "|" + label + "|" + (options.edge === undefined ? "no edge" : options.edge) + "|" + (options.depth | 0) + "|" + (options.tint ? "tint" : "plain"); }
function kept(width, options = {}) { options.seen = (options.seen | 0) + width; return options; }
function counted(options = {}) { let names = 0; for (const name in options) names++; return names + ":" + (options.label === undefined) + ":" + Object.keys(options).join(); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, shape, kept, counted }, names = JSON.parse('["shape","kept","counted"]');
const literal = i => ({ label: "q" + i, depth: i });
class Choice { constructor(i) { this.label = "c" + i; this.depth = i; } get edge() { log.push("edge of the class"); return "above"; } }
const key = text => JSON.parse(JSON.stringify(text));
const rows = [
  ["the literal", i => literal(i)], ["nothing", () => undefined], ["another literal", i => ({ tint: i })], ["all four", i => ({ label: "a", depth: i, tint: 1, edge: 2 })], ["the names in another order", i => ({ depth: i, label: "o" })],
  ["parsed", i => JSON.parse('{"label":"p","depth":' + i + "}")], ["parsed with more", () => JSON.parse('{"label":"p","depth":3,"tint":1,"edge":0,"more":1}')], ["an instance", i => new Choice(i)],
  ["above it the literal", i => Object.create(literal(i))], ["above it a getter", () => Object.create({ get tint() { log.push("tint above"); return 1; } })], ["without a prototype", i => Object.assign(Object.create(null), literal(i))],
  ["a proxy", i => new Proxy(literal(i), { get(target, name) { log.push("get " + String(name)); return target[name]; } })],
  ["a getter of its own", i => ({ get label() { log.push("label read"); return "g"; }, depth: i })], ["frozen", i => Object.freeze(literal(i))], ["sealed", i => Object.seal(literal(i))],
  ["a name gained", i => { const o = literal(i); o.edge = "gained"; return o; }], ["a name gained under a key nobody knows", i => { const o = literal(i); o[key("tint")] = 1; return o; }],
  ["a name deleted", i => { const o = literal(i); delete o.label; return o; }], ["deleted under a key nobody knows", i => { const o = literal(i); delete o[key("depth")]; return o; }],
  ["turned into a getter", i => { const o = literal(i); Object.defineProperty(o, key("depth"), { get() { log.push("depth read"); return 7; }, enumerable: true, configurable: true }); return o; }],
  ["another prototype behind the birth", i => Object.setPrototypeOf(literal(i), { edge: "from above", tint: 1 })], ["undefined under the names", () => ({ label: undefined, depth: undefined })],
  ["a fraction and a text", () => ({ label: 5, depth: "12" })], ["a list", () => ["x"]], ["a function", () => Object.assign(function made() {}, { label: "f" })], ["a text", () => "text"], ["a number", () => 5], ["true", () => true], ["a symbol", () => Symbol.iterator],
];
for (let round = 0; round < 3; round++) {
  for (const [name, make] of rows) console.log(round, name, "|", table[names[0]](round, make(round)), "|", log.splice(0).join(";"));
}
for (const nothing of [null]) { try { table[names[0]](1, nothing); } catch (error) { console.log("null", error.constructor.name); } }
const first = table[names[1]](1), second = table[names[1]](2), given = literal(3);
console.log(first !== second, first.seen, second.seen, table[names[1]](4, given) === given, given.seen, Object.getPrototypeOf(first) === Object.prototype, Object.keys(first).join());
console.log(table[names[2]](), table[names[2]](literal(1)), table[names[2]]({}), table[names[2]](undefined));
