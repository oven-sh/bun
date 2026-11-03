// A heap snapshot has an edge from the environment of a module to what each of its variables holds, under the variable's name.
import { sessions, sizeOfHidden, replaceHidden, dropScratch } from "./store.mjs";

const cache = new Map([["k", { v: 1 }]]);
let counter = { n: 0 };
var list = [1, 2, 3];
class Widget {
  constructor() {
    this.x = 1;
  }
}
const double = x => x * 2;
let large = 10n ** 30n;
const mark = Symbol("mark");
let pattern = /a+/g;
let count = 5;
let released = new Set([1]);

function touch() {
  counter.n += double(count);
  cache.set("t", counter);
  list.push(counter.n);
  large += 1n;
  return [new Widget(), mark, pattern.test("aa"), released, double, Widget];
}

function variablesInSnapshotOfJSC() {
  const snapshot = Bun.generateHeapSnapshot();
  const variable = snapshot.edgeTypes.indexOf("Variable");
  const classOf = new Map();
  for (let i = 0; i < snapshot.nodes.length; i += 4) classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
  const found = [];
  for (let i = 0; i < snapshot.edges.length; i += 4) {
    if (snapshot.edges[i + 2] === variable)
      found.push([snapshot.edgeNames[snapshot.edges[i + 3]], classOf.get(snapshot.edges[i + 1]), classOf.get(snapshot.edges[i]), snapshot.edges[i]]);
  }
  return found;
}

function variablesInSnapshotOfV8() {
  const snapshot = JSON.parse(Bun.generateHeapSnapshot("v8"));
  const { node_fields, node_types, edge_fields, edge_types } = snapshot.snapshot.meta;
  const context = edge_types[0].indexOf("context");
  const [typeAt, nameAt, countAt] = ["type", "name", "edge_count"].map(field => node_fields.indexOf(field));
  const describe = node => {
    const type = node_types[0][snapshot.nodes[node + typeAt]];
    return type === "closure" ? type : type + " " + snapshot.strings[snapshot.nodes[node + nameAt]];
  };
  const found = [];
  let edge = 0;
  for (let node = 0; node < snapshot.nodes.length; node += node_fields.length) {
    for (let left = snapshot.nodes[node + countAt]; left > 0; left--, edge += edge_fields.length) {
      if (snapshot.edges[edge] === context)
        found.push([snapshot.strings[snapshot.edges[edge + 1]], describe(snapshot.edges[edge + 2]), describe(node), node]);
    }
  }
  return found;
}

function show(title, names) {
  console.log(title);
  for (const [format, found] of [["jsc", variablesInSnapshotOfJSC()], ["v8", variablesInSnapshotOfV8()]]) {
    for (const name of names) {
      const ofName = found.filter(row => row[0] === name);
      const lines = [...new Set(ofName.map(row => `${row[1]} in ${row[2]}`))].sort();
      console.log(` ${format} ${name}: ${lines.join(" | ") || "nothing"}; nodes: ${new Set(ofName.map(row => row[3])).size}`);
    }
  }
}

touch();
const sizeOfLater = () => declaredLater.size;
const names = ["cache", "counter", "list", "Widget", "double", "large", "mark", "pattern", "count", "released", "sessions", "hidden", "scratch", "declaredLater", "loadedLater"];
show("at first", names);

replaceHidden();
dropScratch();
released = null;
counter = [counter];
const declaredLater = new Map();
const later = await import("./loaded-later.mjs");
show("after the variables have changed", names);
console.log(sessions.size, sizeOfHidden(), cache.size, list.length, later.size(), sizeOfLater(), touch().length);
