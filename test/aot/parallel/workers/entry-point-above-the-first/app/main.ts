// One entry point lies above the folder of the first, so the root of the executable lies above the folder where the build runs.
// A relative path still names what `bun run` finds from that folder.
// Entry points: ./a.ts ./jobs/b.ts ../lib/c.ts ./jobs/d.ts ./jobs/e.ts
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how: string, worker: Worker) =>
  new Promise<void>(done => {
    const end = (text: string) => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
await report("a relative path", new Worker("./a.ts"));
await report("without its extension", new Worker("./a"));
await report("below a folder", new Worker("./jobs/b.ts"));
await report("a URL", new Worker(new URL("./jobs/b.ts", import.meta.url)));
await report("a URL above", new Worker(new URL("../lib/c.ts", import.meta.url)));
await report("a relative path above", new Worker("../lib/c.ts"));
for (const name of process.argv.length > 99 ? ["b"] : ["d", "e"])
  await report("a name known in part", new Worker("./jobs/" + name + ".ts"));
await report("no ./ in front", new Worker("a.ts"));
await report("no ./ in front, below a folder", new Worker("jobs/b.ts"));
await report("a package", new Worker("pkg"));
await report("a file of a package", new Worker("pkg/worker.js"));
await report("not there", new Worker("./not-there.ts"));
