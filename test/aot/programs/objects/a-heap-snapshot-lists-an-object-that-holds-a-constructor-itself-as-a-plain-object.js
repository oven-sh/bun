// A heap snapshot names an object after the function that made it. One that holds `constructor` itself, as a prototype object does, is listed as a plain object.
function MakerOfOneInstanceInTheSnapshot() {}
const storedLater = { payload: 2 };
storedLater.constructor = MakerOfOneInstanceInTheSnapshot;
globalThis.keptForTheSnapshot = [
  new MakerOfOneInstanceInTheSnapshot(),
  { constructor: MakerOfOneInstanceInTheSnapshot, payload: 1 },
  storedLater,
  { __proto__: { constructor: MakerOfOneInstanceInTheSnapshot }, payload: 3 },
];

const { snapshot, nodes, strings } = JSON.parse(Bun.generateHeapSnapshot("v8"));
const fields = snapshot.meta.node_fields;
const kinds = snapshot.meta.node_types[fields.indexOf("type")];
let count = 0;
for (let at = 0; at < nodes.length; at += fields.length) {
  if (kinds[nodes[at + fields.indexOf("type")]] === "object" && strings[nodes[at + fields.indexOf("name")]] === "MakerOfOneInstanceInTheSnapshot") count++;
}
console.log(count);

const { nodes: cells, nodeClassNames } = Bun.generateHeapSnapshot();
const wanted = nodeClassNames.indexOf("MakerOfOneInstanceInTheSnapshot");
let cellCount = 0;
for (let at = 0; at < cells.length; at += 4) {
  if (cells[at + 2] === wanted) cellCount++;
}
console.log(cellCount, globalThis.keptForTheSnapshot.map(kept => kept.constructor === MakerOfOneInstanceInTheSnapshot).join());
