// The path of an embedded file goes through a Map and through JSON text to `new Worker()`.
// Alone: which files the build compiles for a Worker depends on what else the executable holds
// The load follows no value this far and compiles no embedded file on a guess (src/aot/CONTRACT-front.md, 2.3), so the Worker is refused, and the message says what to do.
import w1 from "./w1.ts" with { type: "file" };
function ask(w: Worker, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      resolve(String(e.data));
      w.terminate();
    };
    w.onerror = e => {
      reject(new Error("worker error: " + e.message));
    };
    w.postMessage(text);
  });
}
const m = new Map<string, string>([["k", w1]]);
const again = JSON.parse(JSON.stringify({ p: w1 })).p;
console.log(await ask(new Worker(m.get("k")!), "a"), await ask(new Worker(again), "b"));
/* Output:
exit code 1
error: worker error: error: Cannot load '/$bunfs/root/w1-ts093c2h.ts': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk.
*/
