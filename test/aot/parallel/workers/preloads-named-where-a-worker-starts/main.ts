// The files that a Worker loads in front of its own, named by `preload` where the Worker starts. No file but this one is named when the program is built.
// Alone: a relative name is looked for from the folder in which the program is built
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const start = (how: string, worker: Worker) =>
  new Promise<void>(done => {
    const end = (text: string) => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
await start("a text", new Worker("./worker.ts", { preload: "./first.ts" }));
await start("a list", new Worker("./worker.ts", { preload: ["./second.ts", "./first.ts"] }));
await start("no extensions", new Worker("./worker", { preload: ["./first", "./third"] }));
const options = { preload: ["./fourth.ts"] };
await start("options in a constant", new Worker("./worker.ts", options));
const more = { preload: "./fifth.ts" };
await start("options that are spread", new Worker("./worker.ts", { name: "spread", ...more }));
const preload = ["./sixth.ts", "./first.ts"];
await start("a list in a constant", new Worker("./worker.ts", { preload }));
