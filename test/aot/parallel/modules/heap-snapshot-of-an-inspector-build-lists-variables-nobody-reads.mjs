// A debugger can read any variable, so a build with --compile-inspector removes none: a heap snapshot lists what each variable of a module holds as plain Bun does, also where nothing in the program reads it.
// Flags: --compile-inspector
let x = {};
globalThis.f = () => {
  x = 1;
};

class OnlyWritten {}
class OnlyRead {}
class WrittenByCall {}
class ReadLater {}
class FieldRead {
  n = 5;
}
class InList {}
class InMap {}
class InDeclaration {}
class InExport {}

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

const fieldRead = new FieldRead();
const readField = () => fieldRead.n;

let inList = [new InList()];
globalThis.writeList = () => {
  inList = 1;
};

let inMap = new Map([[1, new InMap()]]);
globalThis.writeMap = () => {
  inMap = 1;
};

let inDeclaration = new InDeclaration();
function neverCalled() {
  inDeclaration = 1;
}

let inExport = new InExport();
export function neverImported() {
  return inExport;
}

const snapshot = Bun.generateHeapSnapshot();
const variable = snapshot.edgeTypes.indexOf("Variable");
const classOf = new Map();
const objects = new Map();
for (let i = 0; i < snapshot.nodes.length; i += 4) {
  const name = snapshot.nodeClassNames[snapshot.nodes[i + 2]];
  classOf.set(snapshot.nodes[i], name);
  objects.set(name, (objects.get(name) ?? 0) + 1);
}
const held = new Map();
for (let i = 0; i < snapshot.edges.length; i += 4) {
  if (snapshot.edges[i + 2] === variable)
    held.set(snapshot.edgeNames[snapshot.edges[i + 3]], classOf.get(snapshot.edges[i + 1]));
}

for (const name of [
  "x",
  "onlyWritten",
  "onlyRead",
  "writtenByCall",
  "readLater",
  "fieldRead",
  "inList",
  "inMap",
  "inDeclaration",
  "inExport",
])
  console.log(`${name}: ${held.get(name) ?? "not listed"}`);
for (const type of [
  "OnlyWritten",
  "OnlyRead",
  "WrittenByCall",
  "ReadLater",
  "FieldRead",
  "InList",
  "InMap",
  "InDeclaration",
  "InExport",
])
  console.log(`objects of ${type}: ${objects.get(type) ?? 0}`);
console.log(read() instanceof ReadLater, readField());
