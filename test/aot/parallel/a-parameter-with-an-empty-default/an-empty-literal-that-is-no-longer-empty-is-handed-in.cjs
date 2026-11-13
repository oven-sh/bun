// Off the function's own `{}` a read is answered undefined without a lookup. An empty literal that is no longer empty: the caller's, and THE DEFAULT OF AN EARLIER CALL, kept, changed and handed in again:
// a name gained under a key nobody knows, by plain stores, another prototype, a getter laid late, frozen, a name gained and deleted again: each read answers as plain Bun's.
"use strict";
const log = [], kept = [];
function shape(width, options = {}) { kept.push(options); const label = options.label === undefined ? "" : options.label; return width + "|" + label + "|" + (options.edge === undefined ? "no edge" : options.edge) + "|" + (options.depth | 0) + "|" + (options.tint ? "tint" : "plain"); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, name = JSON.parse('"shape"');
const key = text => JSON.parse(JSON.stringify(text));
const ownDefault = () => { table[name](0); return kept[kept.length - 1]; };
const deeds = [
  ["as it is", o => o], ["a name under a key nobody knows", o => { o[key("label")] = "k"; return o; }], ["plain stores", o => { o.label = "s"; o.depth = 2; o.tint = 1; o.edge = 0; return o; }],
  ["another prototype", o => Object.setPrototypeOf(o, { label: "above", tint: 1 })], ["a prototype with a getter", o => Object.setPrototypeOf(o, { get edge() { log.push("edge above"); return "e"; } })],
  ["a getter laid late", o => Object.defineProperty(o, key("label"), { get() { log.push("label read"); return "g"; }, enumerable: true, configurable: true })],
  ["a hidden name", o => Object.defineProperty(o, "depth", { value: 9, enumerable: false })], ["frozen", o => Object.freeze(o)], ["gained, then frozen", o => { o.tint = 1; return Object.freeze(o); }],
  ["gained and deleted again", o => { o.label = "x"; delete o.label; return o; }], ["no prototype", o => Object.setPrototypeOf(o, null)], ["a symbol and a number", o => { o[Symbol.iterator] = 1; o[0] = "zero"; return o; }],
];
table[name](1, { label: "q", depth: 1 });
for (let round = 0; round < 3; round++) {
  for (const [said, deed] of deeds) {
    console.log(round, said, "| the caller's |", table[name](round, deed({})), "| the default of an earlier call |", table[name](round, deed(ownDefault())), "| nothing |", table[name](round), "|", log.splice(0).join(";"));
  }
}
console.log(new Set(kept).size, kept.length);
