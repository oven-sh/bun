// Two files have one name: one lies where the build runs, the other in the folder above, which is the root of the executable because an entry point lies there.
// A relative path names the first, as under `bun run`. A URL names the file that it spells.
// Entry points: ./a.ts ../a.ts ./jobs/d.ts ../jobs/d.ts ../jobs/only-above.ts ./node_modules/pkg/index.js ../node_modules/pkg/index.js
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how: string, worker: Worker) =>
  new Promise<void>(done => {
    const end = (text: string) => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
await report("a relative path", new Worker("./a.ts"));
await report("without its extension", new Worker("./a"));
await report("no ./ in front", new Worker("a.ts"));
await report("a relative path above", new Worker("../a.ts"));
await report("a URL beside", new Worker(new URL("./a.ts", import.meta.url)));
await report("a URL above", new Worker(new URL("../a.ts", import.meta.url)));
for (const name of process.argv.length > 99 ? ["a"] : ["d"])
  await report("a name known in part", new Worker("./jobs/" + name + ".ts"));
await report("a URL below the folder above", new Worker(new URL("../jobs/d.ts", import.meta.url)));
await report("a package", new Worker("pkg"));
