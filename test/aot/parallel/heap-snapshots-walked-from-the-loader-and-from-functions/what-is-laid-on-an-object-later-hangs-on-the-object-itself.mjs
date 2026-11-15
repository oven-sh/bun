// A program lays a member on an object whose members the build knows: on an instance, on a literal, on the object of a built-in module. A heap snapshot shows it under its name on the object itself.
import * as jsc from "bun:jsc";
import fs from "fs";
const take = Reflect.get(jsc, "generateHeapSnapshotForDebugging");
class Shelf {
  constructor(label) {
    this.label = { label };
  }
}
const instance = new Shelf("first");
const literal = { kept: { n: 1 } };
const later = () => ["laid", "Later"].join(globalThis.nothingAtAll ?? "");
instance[later()] = new Map();
literal[later()] = new Set();
Object.defineProperty(fs, Symbol.for("made-up.queue"), { get: function readQueue() { return 1; }, configurable: true });
globalThis.keptForTheWalk = { mark_of_the_start: { instance, literal, fs } };
const raw = take();
const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
const classOf = new Map();
for (let i = 0; i < snapshot.nodes.length; i += 7) classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
const named = new Map();
let start = -1;
for (let i = 0; i < snapshot.edges.length; i += 4) {
  if (snapshot.edgeTypes[snapshot.edges[i + 2]] !== "Property") continue;
  const name = snapshot.edgeNames[snapshot.edges[i + 3]];
  if (name === "mark_of_the_start") start = snapshot.edges[i + 1];
  (named.get(snapshot.edges[i]) ?? named.set(snapshot.edges[i], new Map()).get(snapshot.edges[i])).set(name, snapshot.edges[i + 1]);
}
for (const [holder, name] of [["instance", "label"], ["instance", "laidLater"], ["literal", "kept"], ["literal", "laidLater"], ["fs", "made-up.queue"]])
  console.log(holder + "." + name + ":", classOf.get(named.get(named.get(start).get(holder))?.get(name)) ?? "not under that name");
