// A global variable that the program stores to is no constant: outside hot code a read or a store of it is one call, and it sees every change: a store by name, through globalThis, a redefinition as an accessor, a deletion, a `let` of a later script that shadows it
const lines = [];
globalThis.counter = 1;
globalThis.label = "first";
function readCounter() { return counter; }
function readLabel() { return label; }
function typeOfCounter() { return typeof counter; }
function writeCounter(value) { counter = value; }
function bump() { counter++; return counter; }
function readThroughObject() { return globalThis.counter; }
function readMath() { return Math; }
function readUndefined() { return undefined; }
function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}
lines.push(attempt(readCounter), attempt(readLabel), attempt(typeOfCounter));
for (const value of [2, 2.5, "text", null, undefined, {}, () => 1]) {
  writeCounter(value);
  lines.push(attempt(readCounter), attempt(typeOfCounter), attempt(readThroughObject));
}
writeCounter(10);
lines.push(attempt(bump), attempt(bump), attempt(readCounter));
globalThis.counter = 20;
lines.push(attempt(readCounter), attempt(bump));
for (let i = 0; i < 40; i++) globalThis["filler" + i] = i;
lines.push(attempt(readCounter), attempt(bump), attempt(readLabel));
let reads = 0;
Object.defineProperty(globalThis, "counter", { get() { return "read " + ++reads; }, set(value) { lines.push("the setter got " + value); }, configurable: true });
lines.push(attempt(readCounter), attempt(readCounter), attempt(typeOfCounter));
writeCounter(5);
Object.defineProperty(globalThis, "counter", { value: 30, writable: false, configurable: true });
lines.push(attempt(readCounter), attempt(() => writeCounter(31)), attempt(readCounter));
delete globalThis.counter;
lines.push(attempt(readCounter), attempt(typeOfCounter), attempt(readThroughObject), attempt(() => writeCounter(1)), attempt(bump));
globalThis.counter = 40;
lines.push(attempt(readCounter), attempt(bump));
(0, eval)("let label = 'shadowed by a script';");
lines.push(attempt(readLabel), String(globalThis.label));
lines.push(String(readMath() === Math), attempt(readUndefined));
// An old global object takes a young cell.
Bun.gc(true);
writeCounter({ young: true });
Bun.gc(false);
lines.push(JSON.stringify(readCounter()));
console.log(lines.join("\n"));
