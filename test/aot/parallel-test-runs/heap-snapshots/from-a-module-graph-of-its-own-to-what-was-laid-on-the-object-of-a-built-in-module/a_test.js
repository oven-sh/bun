// A module graph of its own asks for a built-in module. From the namespace that it is given, the steps in a heap snapshot to a getter that the program has laid on the object of the module.
import { test } from "bun:test";
import * as jsc from "bun:jsc";
import fs from "fs";
import path from "path";
test("a", async () => {
  const take = Reflect.get(jsc, "generateHeapSnapshotForDebugging");
  Object.defineProperty(fs, Symbol.for("made-up.queue"), { get: function readQueue() { return 1; }, configurable: true });
  const graph = new Bun.ModuleGraph({});
  const { namespace } = await graph.import(path.join(import.meta.dir, "session.mjs"));
  globalThis.keptForTheWalk = { mark_of_the_namespace: namespace };
  const raw = take();
  const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  const classOf = new Map(), labelOf = new Map();
  for (let i = 0; i < snapshot.nodes.length; i += 7) {
    classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
    labelOf.set(snapshot.nodes[i], snapshot.labels[snapshot.nodes[i + 4]] ?? "");
  }
  const out = new Map();
  let start = -1;
  for (let i = 0; i < snapshot.edges.length; i += 4) {
    const kind = snapshot.edgeTypes[snapshot.edges[i + 2]];
    const name = kind === "Property" || kind === "Variable" ? snapshot.edgeNames[snapshot.edges[i + 3]] : kind === "Index" ? String(snapshot.edges[i + 3]) : "";
    const edge = { from: snapshot.edges[i], to: snapshot.edges[i + 1], kind, name };
    if (kind === "Property" && name === "mark_of_the_namespace") start = edge.to;
    (out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)).push(edge);
  }
  console.log("the namespace is a", classOf.get(start));
  // Breadth first, names before edges without one, leaving out the records of shapes and code, and the global object.
  const skipped = /^(Structure|StructureRareData|StructureChain|PropertyTable|SymbolTable|.*Executable|.*CodeBlock|FunctionRareData|JSSourceCode|JSPropertyNameEnumerator|.*GlobalObject)$/;
  const pathOf = new Map([[start, ""]]);
  const queue = [start];
  const order = ["Property", "Index", "Variable", "Internal"];
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (const edge of (out.get(from) ?? []).toSorted((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const name = classOf.get(edge.to) ?? "";
      if (pathOf.has(edge.to) || skipped.test(name)) continue;
      const step = edge.kind === "Property" ? "." + edge.name : edge.kind === "Index" ? "[" + edge.name + "]" : edge.kind === "Variable" ? "{variable " + edge.name + "}" : "{" + name + "}";
      pathOf.set(edge.to, pathOf.get(from) + step);
      queue.push(edge.to);
      if (labelOf.get(edge.to) === "readQueue") console.log("to the getter:", pathOf.get(edge.to));
    }
  }
  graph.dispose();
});
