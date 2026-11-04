// an object is thrown by a callback of queueMicrotask. Nobody catches it: the host hands it to the listener of uncaughtException, which stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
process.on("uncaughtException", (e: any) => { e.node = "text"; });
function deed(s: Stop) { queueMicrotask(() => { throw s; }); }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
setTimeout(() => { console.log(String(read(held))); }, 1);
