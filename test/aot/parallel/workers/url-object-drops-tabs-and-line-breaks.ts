// The code of a Worker is written over several lines in a data: URL, and comes to the Worker as a URL object: the parser of URLs drops each tab and each line break, so the Worker runs one line.
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const listen = (how: string, worker: Worker) =>
  new Promise<void>(done => {
    const end = (text: string) => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end("message " + JSON.stringify(event.data));
    worker.onerror = event => end("error " + event.message.split("\n")[0].slice(0, 60));
  });
await listen("a tab", new Worker(new URL("data:text/javascript,postMessage('a\tb')")));
await listen(
  "line breaks",
  new Worker(
    new URL(`data:text/javascript,
const first = 'one';
const second = 'line';
postMessage(first + ' ' + second);
`),
  ),
);
