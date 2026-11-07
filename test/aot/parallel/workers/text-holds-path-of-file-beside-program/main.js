// A program puts the text together that a Worker starts from, and the text holds the whole path of a file beside the program.
// Alone: which files the build compiles for a Worker depends on what else the executable holds
// Build prints: 0 x warn: TS100150: Could not resolve: "file:///$bunfs/root/beside.js"
// Build prints: 0 x warn: TS100150: Could not resolve: "file:///B:/%7EBUN/root/beside.js"
const ask = (what, worker) =>
  new Promise(done => {
    const end = text => (console.log(what + ":", text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    // Up to the path, which begins with another drive letter in an executable on Windows.
    worker.onerror = event => end("error " + event.message.split("\n")[0].slice(0, 27));
  });
const file = import.meta.dir + "/beside.js";
const url = new URL("./beside.js", import.meta.url).href;
const refused = 'error => postMessage("refused")';

// The build folds this URL, so an executable must see exactly this form.
const isInExecutable = /^(\/\$bunfs|B:[\\/]~BUN)/.test(import.meta.dir);
console.log("URL as the build folds it:", !isInExecutable || /^file:\/\/\/(\$bunfs|B:\/%7EBUN)\/root\/beside\.js$/.test(url) || url);

await ask(
  "import() of a path",
  new Worker(
    "data:text/javascript," +
      encodeURIComponent('import("' + file + '").then(it => postMessage(it.beside), ' + refused + ")"),
  ),
);
await ask(
  "import() of a URL",
  new Worker(
    "data:text/javascript," +
      encodeURIComponent('import("' + url + '").then(it => postMessage(it.beside), ' + refused + ")"),
  ),
);
await ask(
  "an import statement",
  new Worker(
    "data:text/javascript," + encodeURIComponent('import { beside } from "' + file + '"; postMessage(beside)'),
  ),
);
await ask(
  "require()",
  new Worker("data:text/javascript," + encodeURIComponent('postMessage(require("' + file + '").beside)')),
);
await ask(
  "a blob",
  new Worker(
    URL.createObjectURL(new Blob(['import("' + file + '").then(it => postMessage(it.beside), ' + refused + ")"])),
  ),
);
await ask(
  "a file that is not there",
  new Worker(
    "data:text/javascript," +
      encodeURIComponent(
        'import("' + import.meta.dir + '/absent.js").then(it => postMessage(it.beside), ' + refused + ")",
      ),
  ),
);
