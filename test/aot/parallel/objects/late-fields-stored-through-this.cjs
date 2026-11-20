// The methods of a constructor function store the fields that it leaves out, several methods some of them each. Objects that were filled in part, in other orders, twice or never read as they should.
// COUNT: operation:operationAOTEnsureExtensionGranules <= 4
"use strict";
const log = [];
const show = (o) =>
  Object.keys(o)
    .map((k) => k + "=" + (Object.is(o[k], -0) ? "-0" : typeof o[k] === "object" && o[k] ? "{" + Object.keys(o[k]).length + "}" : String(o[k])))
    .join(",");

function Crate(order) {
  this.notes = {};
  this.mark = order.mark;
  if (order.heap >= 0) this.pack(order);
}
const prototype = Crate.prototype;
prototype.pack = function (order) {
  if (order.empty) this.heap = order.heap;
  else {
    this.fill(order.heap);
    this.heap = order.heap;
  }
};
prototype.fill = function (heap) {
  this.figs = -0;
  this.nuts = heap & 1 ? null : undefined;
  this.apples = 40 + heap;
  this.plums = (heap % 28) + 0.5;
  this.lid = heap % 3 ? "oak" : "ash";
  this.pears = heap % 12;
  this.dates = heap % 24;
};
prototype.turnOver = function (heap) {
  this.lid = "back";
  this.nuts = heap;
  this.figs = heap;
  this.dates = heap;
  this.plums = heap;
  this.pears = heap;
  this.apples = heap;
};
prototype.spill = function () {
  delete this.plums;
  delete this.lid;
  return this;
};
prototype.sum = function () {
  return (this.apples | 0) + (this.pears | 0) + (this.dates | 0) + (this.plums === undefined ? 1000 : this.plums | 0);
};

const all = [];
for (let i = 0; i < 400; i++) {
  const crate = new Crate({ mark: i % 5 ? "red" : "blue", heap: i, empty: i % 7 === 3 });
  if (i % 11 === 4) crate.turnOver(i);
  if (i % 13 === 5) crate.spill();
  if (i % 17 === 6) crate.fill(i + 1);
  if (i % 19 === 7) Object.freeze(crate);
  if (i % 23 === 8 && i % 19 !== 7) crate.later = i;
  all.push(crate);
}
let sum = 0;
for (let turn = 0; turn < 5; turn++) for (const crate of all) sum += crate.sum();
log.push(sum);
for (const crate of all) {
  try {
    crate.dates = "text";
    crate.plums = crate;
  } catch (error) {
    log.push(error.constructor.name);
  }
}
const counts = new Map();
for (const crate of all) {
  const text = show(crate).replace(/\d+(\.\d+)?/g, "n");
  counts.set(text, (counts.get(text) ?? 0) + 1);
}
for (const [text, count] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) log.push(count + " " + text);
log.push(show(all[10]), show(all[4]), show(all[3]), "plums" in all[3], all[3].lid, Object.hasOwn(all[3], "apples"));
log.push(JSON.stringify({ ...all[6], plums: 0 }), JSON.stringify(Object.assign({}, all[7], { plums: 1 })));

// A getter, a setter and a field that cannot be stored into, above the late fields.
function Below(i) {
  this.id = i;
}
Below.prototype.fill = function (i) {
  this.a = i;
  this.b = i / 2;
  this.c = "c" + i;
};
Below.prototype.more = function (i) {
  this.d = i;
  this.e = null;
};
let stored = 0;
for (let i = 0; i < 60; i++) {
  if (i === 20) Object.defineProperty(Below.prototype, "b", { configurable: true, get: () => "above", set: (value) => void (stored += value) });
  if (i === 40) Object.defineProperty(Below.prototype, "e", { value: "fixed", writable: false, configurable: true });
  const below = new Below(i);
  try {
    if (i % 2) below.more(i);
    below.fill(i);
    if (i % 2 === 0) below.more(i);
  } catch (error) {
    log.push(i + error.constructor.name);
  }
  if (i % 10 < 2) log.push(show(below), below.b, below.e);
}
log.push(stored);
for (const line of log) console.log(line);
