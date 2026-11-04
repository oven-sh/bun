// The text of a Worker holds what functions of node:path and node:url, URL objects and String.raw make of the path of the module that starts it. The build must make the same bytes, or the Worker does not get its compiled code.
// Before: the build read import.meta.path | dir | url alone: "crashIfInterpreterIsUsed: Worker data:text/javascript,postMessage(String.raw%60%2F%24bunfs%2Froot%2F..".
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path, { dirname, resolve, sep } from "node:path";
import * as urls from "node:url";
import { pathToFileURL as toUrl } from "node:url";

const ask = worker =>
  new Promise(done => {
    const end = answer => (worker.terminate(), done(answer));
    worker.onmessage = event => end(event.data);
    worker.onerror = event => end("error " + event.message.split("\n")[0].slice(0, 40));
  });
const beside = new URL("./a b.js", import.meta.url);
const started = [
  ["dirname(fileURLToPath())", dirname(urls.fileURLToPath(import.meta.url)), ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + dirname(urls.fileURLToPath(import.meta.url)) + "`)")))],
  ["resolve()", resolve(import.meta.dir, "../x/./y.js"), ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + resolve(import.meta.dir, "../x/./y.js") + "`)")))],
  ["join() and sep", path.join(import.meta.dir, "a", "..", "b") + sep + "x", ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + path.join(import.meta.dir, "a", "..", "b") + sep + "x`)")))],
  ["join() that ends in a separator", path.join(import.meta.dir, "c/") + "x", ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + path.join(import.meta.dir, "c/") + "x`)")))],
  ["pathToFileURL().href", toUrl(import.meta.path).href, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + toUrl(import.meta.path).href + "`)")))],
  ["pathname", new URL(import.meta.url).pathname, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + new URL(import.meta.url).pathname + "`);1")))],
  ["a URL that the parser escapes", beside.href, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + beside.href + "`)")))],
  ["toString()", beside.toString(), ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + beside.toString() + "`);1")))],
  ["a URL in a template", `${beside}`, ask(new Worker("data:text/javascript," + encodeURIComponent(`postMessage("${beside}");2`)))],
  ["String.raw", String.raw`${import.meta.dir}\d`, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + String.raw`${import.meta.dir}\d` + "`)")))],
];
for (const [what, atRunTime, answer] of started) console.log(what + ":", (await answer) === atRunTime);
