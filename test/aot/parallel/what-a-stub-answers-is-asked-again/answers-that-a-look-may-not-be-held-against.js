// Flags: --aot-testing=CheckWalkAtRunTime
// Four kinds of answers that differ from what a second look finds, rightly: each was a false alarm of a first form of the net.
// A getter that lays a value in its own place: what it gave is not what lies there now. The length of a view and the size of a table: the stub reads them in line where the object finds a native getter. The name of a function: a new string each time. An accessor without a getter: undefined.
// COUNTER: FastPathResultsVerified >= 100
const unseen = (0, eval)("(x) => x");
function lazy() { return unseen({ get once() { Object.defineProperty(this, "once", { value: [1, 2], configurable: true }); return "the first answer"; } }); }
function readOnce(x) { return x.once; }
function sizeOf(x) { return x.size; }
function lengthOf(x) { return x.length; }
function nameOf(x) { return x.name; }
function mute(x) { return x.mute; }
const out = [];
for (let i = 0; i < 40; i++) {
  const one = lazy();
  out.push(String(readOnce(one)), String(readOnce(one)));
  out.push(sizeOf(unseen(i % 2 ? new Map([[1, 2]]) : new Set([1, 2, 3]))));
  out.push(lengthOf(unseen(i % 3 ? new Uint8Array(i) : i % 2 ? "text" : [1, 2])));
  out.push(nameOf(unseen(i % 2 ? Object.getOwnPropertyDescriptor({ get total() { return 1; } }, "total").get : function named() {})));
  out.push(mute(unseen(Object.defineProperty({}, "mute", { set(v) {}, configurable: true }))));
}
console.log(out.join());
