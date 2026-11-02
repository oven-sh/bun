// Where a Worker starts, a `--define` whose value is one name puts the constructor for a path, the class of the URL, a URL in front of `.href`, a URL that a condition picks and the options that name a preload. The build compiles every file that a Worker loads.
// Flags: --define process.env.MAKER=Made --define U=Link --define ENTRY=entry --define PICKED=picked --define OPTIONS=options
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const Made = Worker;
const Link = URL;
const entry = new URL("./first.mjs", import.meta.url);
const picked = process.argv.length > 9 ? entry : new URL("./second.mjs", import.meta.url);
const options = { preload: new URL("./before.mjs", import.meta.url).href };
const start = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
await start("a constructor for a path", new process.env.MAKER(new URL("./fifth.mjs", import.meta.url)));
await start("a class of URLs", new Worker(new U("./third.mjs", import.meta.url)));
await start("an href", new Worker(ENTRY.href));
await start("a URL that a condition picks", new Worker(PICKED));
await start("options", new Worker(new URL("./fourth.mjs", import.meta.url), OPTIONS));
