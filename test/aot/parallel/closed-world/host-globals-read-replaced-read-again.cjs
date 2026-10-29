// closed-world/host-members-read-replaced-and-read-again for the globals that hold objects and functions of the host.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "")); }
}
const words = JSON.parse(globalThis.process.argv[2] ?? `{ "process": "process", "fetch": "fetch", "performance": "performance", "navigator": "navigator", "structuredClone": "structuredClone", "queueMicrotask": "queueMicrotask", "Blob": "Blob" }`);
const hidden = value => new Proxy({ value }, {}).value;
const kind = value => value === null ? "null" : typeof value === "object" || typeof value === "function" ? (value.mine ?? typeof value) : String(value);
const realProcess = process, realm = globalThis;

function readProcess() { return kind(process); }
function readPid() { return typeof process.pid; }
function readFetch() { return kind(fetch); }
function readPerformance() { return kind(performance); }
function readNavigator() { return kind(navigator); }
function readStructuredClone() { return kind(structuredClone); }
function readQueueMicrotask() { return kind(queueMicrotask); }
function readBlob() { return kind(Blob); }

attempt("process, before", () => readProcess() + " " + readPid());
attempt("process, by the free name", () => { process = { mine: "free name" }; return readProcess() + " " + readPid(); });
attempt("process, by globalThis.process", () => { globalThis.process = { mine: "named" }; return readProcess(); });
attempt("process, under a computed key", () => { realm[words.process] = { mine: "computed" }; return readProcess(); });
attempt("process, through a receiver nobody follows", () => { hidden(realm)[words.process] = { mine: "hidden" }; return readProcess(); });
attempt("process, by a definition", () => { Object.defineProperty(realm, words.process, { value: { mine: "defined" }, configurable: true, writable: true }); return readProcess(); });
attempt("process, put back", () => { realm.process = realProcess; return readProcess() + " " + readPid() + " " + (process === realProcess); });

attempt("fetch, before", readFetch);
attempt("fetch, through a receiver nobody follows", () => { const mine = () => {}; mine.mine = "hidden"; hidden(realm)[words.fetch] = mine; return readFetch(); });
attempt("performance, replaced before the first read", () => { hidden(realm)[words.performance] = { mine: "hidden" }; return readPerformance(); });
attempt("navigator, defined before the first read", () => { Object.defineProperty(hidden(realm), words.navigator, { value: { mine: "defined" }, configurable: true }); return readNavigator(); });
attempt("structuredClone, deleted", () => { readStructuredClone(); delete hidden(realm)[words.structuredClone]; return typeof structuredClone; });
attempt("queueMicrotask, in a loop that replaces it half way", () => {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(readQueueMicrotask());
    if (i === 1) hidden(realm)[words.queueMicrotask] = { mine: "replaced in round " + i };
  }
  return seen.join(" | ");
});
attempt("Blob, by Object.assign", () => { readBlob(); Object.assign(realm, JSON.parse(`{ "Blob": { "mine": "assigned" } }`)); return readBlob(); });
/* Output:
process, before: object number
process, by the free name: TypeError
process, by globalThis.process: TypeError
process, under a computed key: TypeError
process, through a receiver nobody follows: TypeError
process, by a definition: TypeError
process, put back: object number true
fetch, before: function
fetch, through a receiver nobody follows: hidden
performance, replaced before the first read: hidden
navigator, defined before the first read: defined
structuredClone, deleted: undefined
queueMicrotask, in a loop that replaces it half way: function | function | replaced in round 1 | replaced in round 1
Blob, by Object.assign: assigned
*/
