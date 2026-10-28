// The ways to spell the file that a Worker starts from. Each spelling has a file of its own, and no file but this one is named when the program is built.
// Alone: a relative name is looked for from the folder in which the program is built
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: EngineRuns = 21
const start = (how: string, worker: Worker) =>
  new Promise<void>(done => {
    const end = (text: string) => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
await start("as the file is named", new Worker("./written.ts"));
await start("no extension", new Worker("./none"));
await start(".js for .ts", new Worker("./other.js"));
await start("a folder", new Worker("./folder"));
await start("the index file of a folder", new Worker("./inner/index"));
await start("a file beside a folder of its name", new Worker("./both"));
await start("that folder, with / at the end", new Worker("./both/"));
await start("no ./ in front", new Worker("bare.ts"));
await start("no ./ in front and no extension", new Worker("short"));
await start("a file of a package", new Worker("pool/lib/job.js"));
await start("a file of a package, no extension", new Worker("pool/lib/task"));
await start("a package", new Worker("pool"));
await start("a key of exports", new Worker("gate/job"));
await start("a URL", new Worker(new URL("./by-url.ts", import.meta.url)));
await start("a URL, no extension", new Worker(new URL("./by-short-url", import.meta.url)));
await start("a URL, .js for .ts", new Worker(new URL("./by-other-url.js", import.meta.url)));
await start("import.meta.resolve", new Worker(import.meta.resolve("./resolved")));
await start("import.meta.dir", new Worker(import.meta.dir + "/joined"));
await start("a path of tsconfig.json", new Worker("@workers/job"));
await start("a path of tsconfig.json with its extension", new Worker("@workers/task.ts"));
