// Global read before a throw sees every change.
const readers = [
  function () {
    throw [marker, typeof marker, globalThis.marker];
  },
  function () {
    throw [marker, typeof marker, globalThis.marker];
  },
];
function read(i) {
  try {
    readers[i & 1]();
  } catch (thrown) {
    return thrown instanceof ReferenceError ? "ReferenceError" : JSON.stringify(thrown);
  }
}
function readOften(label) {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(read(i));
  console.log(label, [...seen].join(" | "));
}
readOften("undeclared");
globalThis.marker = 1;
readOften("assigned");
globalThis.marker = 2;
readOften("assigned again");
marker = 3;
readOften("assigned as a free name");
Object.defineProperty(globalThis, "marker", { value: 4, writable: false, configurable: true });
readOften("read-only");
Object.defineProperty(globalThis, "marker", { value: 5 });
readOften("redefined");
let calls = 0;
Object.defineProperty(globalThis, "marker", { get: () => ++calls > 0 && "getter", configurable: true });
readOften("getter");
console.log("getter calls", calls);
delete globalThis.marker;
readOften("deleted");
Object.defineProperty(globalThis, "marker", { value: 7, writable: false, configurable: false });
readOften("fixed");
const RealError = Error;
const errorReaders = [
  function () {
    throw [Error === RealError, typeof Error];
  },
  function () {
    throw [Error === RealError, typeof Error];
  },
];
function readError(i) {
  try {
    errorReaders[i & 1]();
  } catch (thrown) {
    return JSON.stringify(thrown);
  }
}
for (let i = 0; i < 40; i++) readError(i);
console.log("Error", readError(0));
