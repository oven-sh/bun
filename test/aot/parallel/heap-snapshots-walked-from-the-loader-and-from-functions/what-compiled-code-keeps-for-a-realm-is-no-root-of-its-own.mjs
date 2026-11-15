// What compiled code keeps for a realm (its functions, the scopes of its modules, its prototypes) is marked once the realm's global object is.
// A heap snapshot says so: its reason is "Output", as for all that is marked because another cell is. Said to be roots of their own, they made
// a global object that only a word on the stack still held look as if the heap held it.
import * as jsc from "bun:jsc";
const take = Reflect.get(jsc, "generateHeapSnapshotForDebugging");
class Shelf {
  constructor(label) {
    this.label = label;
  }
}
const shelves = [new Shelf("first"), new Shelf("second")];
const countShelves = () => shelves.length;
const raw = take();
const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
const classOf = new Map();
for (let i = 0; i < snapshot.nodes.length; i += 7)
  classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
const rootsForCode = new Set();
for (let i = 0; i < snapshot.roots.length; i += 3)
  if (String(snapshot.labels[snapshot.roots[i + 1]]) === "CodeBlocks") rootsForCode.add(classOf.get(snapshot.roots[i]));
console.log("shelves:", countShelves());
console.log("the global object is a root for the sake of code:", rootsForCode.has("GlobalObject"));
for (const name of ["Function", "Object", "Array", "Promise", "JSModuleEnvironment", "JSGlobalProxy"])
  console.log(name + " is:", rootsForCode.has(name));
