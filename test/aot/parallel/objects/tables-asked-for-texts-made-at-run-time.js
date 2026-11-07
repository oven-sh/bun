// Tables of every make are asked under texts that are put together at run time: some spell a name of the table, some a name that only another object has, some nothing that anything is called, some an index.
const literal = { get: 1, post: 2, put: 3, patch: 4, default: 9, 7: "seven", 12: "twelve" };
const filled = {};
for (const name of ["get", "post", "put", "patch", "default", "7", "12"]) filled[name] = name.length;
const bare = Object.assign(Object.create(null), { get: "g", default: "d" });
class Routes {
  constructor() {
    this.get = "route get";
    this.head = "route head";
  }
  options() {
    return "method";
  }
  get computed() {
    return "getter";
  }
}
const routes = new Routes();
const grown = new Routes();
grown.later = "later";
grown[3] = "three";
const below = Object.create(literal);
below.own = "own";
const onlyElsewhere = { neverAskedByItsName: 1, alsoNeverAsked: 2 };
const list = ["zero", "one"];
list.label = "list";
const text = new String("ab");
const tables = { literal, filled, bare, routes, grown, below, onlyElsewhere, list, text, func: Object.assign(function () {}, { get: "f" }), proxy: new Proxy(literal, {}), map: new Map(), bytes: new Uint8Array(2) };

const halves = JSON.parse('[["g","et"],["po","st"],["de","fault"],["opt","ions"],["comp","uted"],["la","ter"],["ow","n"],["never","AskedByItsName"],["also","NeverAsked"],["no","body"],["x",""],["","7"],["1","2"],["0","7"],["1","e3"],["-","1"],["3",""],["len","gth"],["to","String"],["__pro","to__"],["constr","uctor"],["la","bel"],["é","té"],["Ж","з"],["a very long text that nothing is called, ","longer than any name of the program by far"]]');
function joined(a, b) {
  return a + b;
}
function cut(a, b) {
  return ("<<" + a + b + ">>").slice(2, 2 + a.length + b.length);
}
function coded(a, b) {
  const whole = a + b;
  let out = "";
  for (let i = 0; i < whole.length; i++) out += String.fromCharCode(whole.charCodeAt(i));
  return out;
}
function answer(table, key) {
  let found;
  try {
    found = table[key];
  } catch (error) {
    found = error.constructor.name;
  }
  return (typeof found === "function" ? "function" : typeof found === "object" && found !== null ? "object" : String(found)) + (key in table ? "+" : "-") + (Object.hasOwn(table, key) ? "!" : "");
}
for (const name in tables) {
  const table = tables[name];
  for (const make of [joined, cut, coded]) {
    const line = [];
    for (const [a, b] of halves) line.push(answer(table, make(a, b)));
    console.log(name, make.name, line.join(" "));
  }
}

// A miss, then a store under the same text, then a hit: a table that remembers.
function remember(table, count) {
  let misses = 0;
  let hits = 0;
  for (let turn = 0; turn < count; turn++) {
    const key = "k" + (turn % 300);
    const known = table[key];
    if (known === undefined) {
      misses++;
      table[key] = turn;
    } else hits += known === turn % 300 ? 1 : 1000;
  }
  return misses + ":" + hits;
}
console.log(remember({}, 900), remember({ seed: 1 }, 900), remember(new Routes(), 900), remember(Object.create(null), 900));

// The name comes into being after it was looked for in vain.
const lateTable = { first: 1 };
const lateKey = joined("made", "Later");
console.log(lateTable[lateKey], lateKey in lateTable);
lateTable[joined("made", "Later")] = "now";
console.log(lateTable[joined("made", "Later")], lateTable[cut("made", "Later")], coded("made", "Later") in lateTable, lateTable.madeLater);
