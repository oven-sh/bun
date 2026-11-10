// Under --isolate each test file has a global object of its own. When this file runs, a word on the stack may still hold the one of a_test.js: whether it
// does hangs on how Bun was built. A heap snapshot has no entry for such a word, so a walk from its roots does not get there. What compiled code keeps for
// a realm is marked once the realm's global object is. Said to be roots of their own, they led the walk to the global object of a_test.js, as a leak would.
import * as jsc from "bun:jsc";
import { expect, test } from "bun:test";
import { shelves } from "./shelves.js";

const take = Reflect.get(jsc, "generateHeapSnapshotForDebugging");

function walk() {
  const raw = take();
  const { nodes, edges, roots, nodeClassNames, labels } = typeof raw === "string" ? JSON.parse(raw) : raw;
  const classOf = new Map();
  for (let i = 0; i < nodes.length; i += 7) classOf.set(nodes[i], nodeClassNames[nodes[i + 2]]);
  const below = new Map();
  for (let i = 0; i < edges.length; i += 4)
    (below.get(edges[i]) ?? below.set(edges[i], []).get(edges[i])).push(edges[i + 1]);
  const reached = new Set();
  const rootsForCode = new Set();
  // These are marked because another cell is, which only the stack may hold.
  const follows = reason => reason === "Output" || reason === "WeakSets" || reason.includes("DOMGCOutput");
  for (let i = 0; i < roots.length; i += 3) {
    const reason = String(labels[roots[i + 1]]);
    if (!follows(reason)) reached.add(roots[i]);
    // Two structures belong to no realm.
    if (reason === "CodeBlocks" && classOf.get(roots[i]) !== "Structure") rootsForCode.add(classOf.get(roots[i]));
  }
  for (const cell of reached) for (const next of below.get(cell) ?? []) reached.add(next);
  let globalObjects = 0;
  for (const cell of reached) if (classOf.get(cell) === "GlobalObject") globalObjects++;
  return { globalObjects, rootsForCode: rootsForCode.size };
}

test("a walk from the roots meets one global object", async () => {
  const met = await new Promise(resolve => setTimeout(() => resolve(walk()), 0));
  console.log("shelves:", shelves.length, "mark of the first file:", typeof globalThis.markOfTheFirstFile);
  console.log("global objects that the heap holds:", met.globalObjects);
  console.log("classes of which a cell is a root for the sake of code:", met.rootsForCode);
  expect(met).toEqual({ globalObjects: 1, rootsForCode: 0 });
});
