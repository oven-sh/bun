// A heap snapshot names a variable of a module exactly when the heap holds what the variable was given.
// A build may remove a variable that nothing can read, and make an object only when it is first read: then the snapshot has neither the object nor the edge.
class OnlyWritten {}
class OnlyRead {}
class WrittenByCall {}
class ReadLater {}
class InList {}
class InDeclaration {}
class Watched {}
class MayBeCalled {}
class HandedToNativeCode {}
class InMap {}

let onlyWritten = new OnlyWritten();
globalThis.writeIt = () => {
  onlyWritten = 1;
};

let onlyRead = new OnlyRead();
globalThis.readIt = () => onlyRead;

let writtenByCall = 0;
const write = () => {
  writtenByCall = new WrittenByCall();
};
write();

let readLater = new ReadLater();
const read = () => readLater;

let inList = [new InList()];
globalThis.writeList = () => {
  inList = 1;
};

let inDeclaration = new InDeclaration();
function neverCalled() {
  inDeclaration = 1;
}

let watched = new Watched();
const weak = new WeakRef(watched);
globalThis.writeWatched = () => {
  watched = 1;
};

let mayBeCalled = new MayBeCalled();
globalThis.chosenByName = () => {
  mayBeCalled = 1;
};

let handedToNativeCode = new HandedToNativeCode();
process.on("an event nobody emits", () => {
  handedToNativeCode = 1;
});

let inMap = new Map([[1, new InMap()]]);
globalThis.writeMap = () => {
  inMap = 1;
};

const snapshot = Bun.generateHeapSnapshot();
const variable = snapshot.edgeTypes.indexOf("Variable");
const objects = new Map();
for (let i = 0; i < snapshot.nodes.length; i += 4) {
  const name = snapshot.nodeClassNames[snapshot.nodes[i + 2]];
  objects.set(name, (objects.get(name) ?? 0) + 1);
}
const named = new Set();
for (let i = 0; i < snapshot.edges.length; i += 4) {
  if (snapshot.edges[i + 2] === variable) named.add(snapshot.edgeNames[snapshot.edges[i + 3]]);
}

console.log("named exactly when the object is there");
for (const [name, type] of Object.entries({
  onlyWritten: "OnlyWritten",
  onlyRead: "OnlyRead",
  writtenByCall: "WrittenByCall",
  readLater: "ReadLater",
  inList: "InList",
  inDeclaration: "InDeclaration",
})) {
  const count = objects.get(type) ?? 0;
  console.log(
    ` ${name}: ${count <= 1 && named.has(name) === (count === 1) ? "yes" : `no: named ${named.has(name)}, objects ${count}`}`,
  );
}
console.log("there, and named");
for (const [name, type] of Object.entries({
  watched: "Watched",
  mayBeCalled: "MayBeCalled",
  handedToNativeCode: "HandedToNativeCode",
  inMap: "InMap",
}))
  console.log(` ${name}: named ${named.has(name)}, objects ${objects.get(type) ?? 0}`);
console.log(
  read() instanceof ReadLater,
  weak.deref() instanceof Watched,
  typeof globalThis[process.argv.length > 99 ? "writeIt" : "chosenByName"],
);
