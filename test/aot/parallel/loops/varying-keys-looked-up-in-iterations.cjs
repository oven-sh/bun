// STATISTIC: VaryingKeyLookups >= 4
// Under: --aot-harden=proof-checks: what a lookup in an iteration finds is asked of memory again
// Under: --aot-testing=FailSpeculations: each iteration restarts at a lookup that finds no answer
// Under: --aot-testing=CheckEffectsAtRunTime: the lookups write nothing and run no code of the program
// Keyed reads of holders of which nothing is known, under a key that each iteration brings: the scan of a parser's open elements. Keys and holders of every kind, getters and traps that change the list, the holders and the prototypes in the middle of the loop.
"use strict";
const lines = [], line = text => lines.push(text);
const told = v => v === undefined ? "u" : v === null ? "0" : typeof v === "symbol" ? "s" : typeof v === "function" ? "f" : typeof v === "object" ? "o" : String(v);
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const host = JSON.parse('{"a":1}');
const HTML = "http://www.w3.org/1999/xhtml";
function isA(elt, set) {
  if (typeof set === "string")
    return elt.ns === HTML && elt.name === set;
  var names = set[elt.ns];
  return names && names[elt.name];
}
function ElementStack() { this.elements = []; this.top = null; }
ElementStack.prototype.push = function (e) { this.elements.push(e); this.top = e; };
ElementStack.prototype.inScope = function (tag, set) {
  for (var i = this.elements.length - 1; i >= 0; i--) {
    var elt = this.elements[i];
    if (isA(elt, tag)) return "t" + i;
    if (isA(elt, set)) return "s" + i;
  }
  return "-";
};
function Table() { this.rows = []; }
Table.prototype.count = function (table) {
  let found = 0, text = "";
  for (let i = 0; i < this.rows.length; i++) {
    const row = this.rows[i];
    if (row.key === "never") return "never";
    const v = table[row.key];
    if (v) found++;
    else text += told(v);
  }
  return found + ":" + text.length;
};
Table.prototype.nest = function (tables) {
  let found = 0;
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (row.key === "never" || row.other === "never") return -1;
      const inner = table[row.key];
      if (inner && inner[row.other]) found += t + 1;
    }
  }
  return found;
};
Table.prototype.withoutLoop = function (row, table) { if (row.key === "never") return 0; const inner = table[row.key]; return inner && inner[row.other]; };
function find(table, rows, key) { for (let i = 0; i < rows.length; i++) { const row = rows[i]; if (row.other === "never") break; if (row.key === key) return table[row.other]; } return undefined; }
Table.prototype.copied = function (table) { let text = ""; for (let i = 0; i < this.rows.length; i++) text += told(find(table, this.rows, this.rows[i].key)); return text.length + text.slice(0, 12); };
Table.prototype.pattern = function (table) { let n = 0; this.rows.forEach(({ key, other = "x" }, i) => { if (key === "never") return; if (table[key]) n += i; if (table[other]) n++; }); return n; };
Table.prototype.sum = function (table) { let sum = 0; for (let i = 0; i < this.rows.length; i++) { const row = this.rows[i]; if (row.key === "never") continue; const v = table[row.key]; if (typeof v === "number") sum += v; } return sum; };
Table.prototype.written = function (table, log) { for (let i = 0; i < this.rows.length; i++) { const row = this.rows[i]; if (row.key === "never") break; const v = table[row.key]; if (v === undefined) { log.push(told(row.key)); continue; } log.push(told(v)); if (log.length > 40) break; } return log.join(); };
host.ElementStack = ElementStack;
host.Table = Table;
host.inScope = (elements, tag, set) => { const stack = new host.ElementStack(); stack.elements = elements; host.stack = stack; return host.stack.inScope(tag, set); };
for (const name of ["count", "nest", "copied", "pattern", "sum", "written"])
  host[name] = (rows, ...rest) => { const table = new host.Table(); table.rows = rows; host.table = table; return host.table[name](...rest); };
host.withoutLoop = (row, table) => new host.Table().withoutLoop(row, table);

const makeRows = (n, keys) => JSON.parse(JSON.stringify(Array.from({ length: n }, (_, i) => ({ key: keys[i % keys.length], other: keys[(i + 1) % keys.length] }))));
// Names of which each is a string of its own.
const fresh = text => [...text].join("");
const makeElements = n => Array.from({ length: n }, (_, i) => ({ ns: i % 7 === 3 ? fresh("http://www.w3.org/2000/svg") : HTML, name: fresh(["div", "section", "p", "li"][i % 3]) }));
const scope = Object.create(null);
scope[HTML] = Object.assign(Object.create(null), { table: true, td: true, html: true });
scope["http://www.w3.org/2000/svg"] = { __proto__: null, title: true };
const button = Object.create(scope);
button[HTML] = Object.create(scope[HTML]);
button[HTML].button = true;

for (const n of [0, 1, 2, 9, 300, 1200]) {
  const elements = makeElements(n);
  line("scope " + n + " " + [host.inScope(elements, "p", button), host.inScope(elements, "x", scope), host.inScope(elements, "div", button), host.inScope(elements, "x", "li"), host.inScope(elements, scope, button)].join(" "));
  if (n > 5) {
    elements[2] = { ns: HTML, name: fresh("td") };
    line("stop " + host.inScope(elements, "x", button));
    elements[4] = { ns: HTML, get name() { elements.length = 6; return "q"; } };
    line("getter " + host.inScope(elements, "x", button) + " " + elements.length);
  }
}
const keys = ["one", "two", "three", "four", "absent", "0", "1", "length", "toString", "constructor", "__proto__"];
let reads = 0;
const holders = {
  dictionary: () => ({ one: 1, two: 2, three: 3 }),
  bare: () => Object.assign(Object.create(null), { one: 1, four: 4 }),
  list: () => Object.assign([5, 6], { one: 7 }),
  text: () => "ab",
  number: () => 5,
  closure: () => Object.assign(function (a, b) { }, { one: 3 }),
  proxy: () => new Proxy({ one: 1 }, { get(target, key) { reads++; return key === "two" ? 22 : target[key]; } }),
  getter: () => ({ get one() { reads++; return reads % 3; }, two: 2 }),
  above: () => Object.create({ two: 2, get three() { reads++; return this.two; } }, { one: { value: 11 } }),
  view: () => Object.assign(new Uint8Array([9, 8]), { one: 2 }),
  map: () => new Map([["one", 1]]),
  nothing: () => null,
  undefined: () => undefined,
  many: () => Object.fromEntries(Array.from({ length: 90 }, (_, i) => ["k" + i, i]).concat([["one", 1]])),
};
for (const name of Object.keys(holders)) {
  for (const n of [3, 24, 400]) {
    const rows = makeRows(n, keys);
    reads = 0;
    line(name + " " + n + " " + [attempt(() => host.count(rows, holders[name]())), attempt(() => host.sum(rows, holders[name]())), attempt(() => host.copied(rows, holders[name]())), attempt(() => host.pattern(rows, holders[name]())), attempt(() => host.written(rows, holders[name](), [])), reads].join(" | "));
  }
}
// Keys that are no strings.
const symbol = Symbol("s");
const odd = [1, 0, -1, 1.5, true, null, undefined, symbol, { toString() { reads++; return "one"; } }, ["two"], 10n, "one"];
for (const name of ["dictionary", "list", "proxy", "above", "view", "text"]) {
  const rows = Array.from({ length: 60 }, (_, i) => ({ key: odd[i % odd.length], other: "one" }));
  reads = 0;
  line("odd " + name + " " + [attempt(() => host.count(rows, holders[name]())), attempt(() => host.sum(rows, holders[name]())), attempt(() => host.written(rows, holders[name](), [])), reads].join(" | "));
}
// Holders that change in the middle.
for (const at of [0, 5, 200]) {
  const table = { one: 1, two: 2 }, rows = makeRows(400, ["one", "two", "absent", "late"]);
  Object.defineProperty(rows[at], "key", { get() { table.late = 9; delete table.two; return "one"; }, configurable: true });
  line("grows " + at + " " + host.count(rows, table) + " " + host.sum(rows, table));
  const below = Object.create({ one: 5 }), others = makeRows(300, ["one", "late"]);
  Object.defineProperty(others[at], "key", { get() { Object.setPrototypeOf(below, { late: 6 }); return "late"; } });
  line("prototype " + at + " " + host.sum(others, below) + " " + host.count(others, below));
  const held = JSON.parse('{"one":1}'), last = makeRows(300, ["one", "two"]);
  Object.defineProperty(last[at], "key", { get() { Object.defineProperty(held, "two", { get() { reads++; return 3; }, configurable: true }); return "two"; } });
  reads = 0;
  line("accessor " + at + " " + host.sum(last, held) + " " + reads);
}
const tables = [{ one: { two: 1 }, two: { three: 0 } }, Object.create({ one: { two: 1 } }), { one: "two", three: null }, new Proxy({}, { get: (t, k) => { reads++; return k === "one" ? { two: 5 } : undefined; } })];
reads = 0;
for (const n of [1, 10, 200]) line("nest " + n + " " + host.nest(makeRows(n, ["one", "two", "three"]), tables) + " " + reads);
line("no loop " + [host.withoutLoop({ key: "one", other: "two" }, tables[0]), host.withoutLoop({ key: "x", other: "two" }, tables[1]), attempt(() => host.withoutLoop({ key: "one", other: "two" }, null))].map(told).join());
let total = 0;
const elements = makeElements(64);
for (let i = 0; i < 4000; i++) total += host.inScope(elements, "x", i & 1 ? button : scope).length + (host.inScope(elements, "li", "p") === "-" ? 1 : 0);
line("total " + total);
console.log(lines.join("\n"));
