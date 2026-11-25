// a promise is rejected with an object and nobody has handled it yet, so the host hands the object to the listener of unhandledRejection, which stores a text into its number field. Only then is the promise awaited under a handler
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
process.on("unhandledRejection", (e: any) => { e.node = "text"; });
function wait() { return new Promise<void>(resolve => { setTimeout(resolve, 1); }); }
async function deed(s: Stop) { const rejected = Promise.reject(s); await wait(); try { await rejected; } catch (e) { return "caught"; } return "passed"; }
const held = new Stop(1);
console.log(String(read(held)));
console.log(await deed(held));
console.log(String(read(held)));
export {};
