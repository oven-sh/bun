// A heap snapshot lists an object that holds `constructor` itself as a plain object. Nothing in this program reads that property, so the compiler removes it, and the snapshot lists the object under the class above it (docs/compiler/compatibility.mdx).
class AboveTheLiteralInTheSnapshot {}
function HeldByTheLiteralInTheSnapshot() {}
globalThis.keptForTheSnapshot = [{ __proto__: AboveTheLiteralInTheSnapshot.prototype, constructor: HeldByTheLiteralInTheSnapshot, payload: 1 }];

const { nodes: cells, nodeClassNames } = Bun.generateHeapSnapshot();
function countOf(name) {
  const wanted = nodeClassNames.indexOf(name);
  let count = 0;
  for (let at = 0; at < cells.length; at += 4) {
    if (cells[at + 2] === wanted) count++;
  }
  return wanted < 0 ? 0 : count;
}
console.log(countOf("AboveTheLiteralInTheSnapshot"), countOf("HeldByTheLiteralInTheSnapshot"));

const { snapshot, nodes, strings } = JSON.parse(Bun.generateHeapSnapshot("v8"));
const fields = snapshot.meta.node_fields;
const kinds = snapshot.meta.node_types[fields.indexOf("type")];
const counts = { AboveTheLiteralInTheSnapshot: 0, HeldByTheLiteralInTheSnapshot: 0 };
for (let at = 0; at < nodes.length; at += fields.length) {
  const name = strings[nodes[at + fields.indexOf("name")]];
  if (kinds[nodes[at + fields.indexOf("type")]] === "object" && Object.hasOwn(counts, name)) counts[name]++;
}
console.log(counts.AboveTheLiteralInTheSnapshot, counts.HeldByTheLiteralInTheSnapshot, globalThis.keptForTheSnapshot[0].payload);
