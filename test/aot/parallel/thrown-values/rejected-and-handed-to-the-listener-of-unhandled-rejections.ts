// an object is thrown by an async function whose promise nobody handles: the host hands it to the listener of unhandledRejection, which stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
process.on("unhandledRejection", (e: any) => { e.node = "text"; });
async function fails(s: Stop) { throw s; }
function deed(s: Stop) { fails(s); }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
setTimeout(() => { console.log(String(read(held))); }, 1);
