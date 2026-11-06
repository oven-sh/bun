// The text of a Worker holds a path of the module that starts it. The build must put the text together with the separators that the program sees when it runs, or the Worker does not get its compiled code.
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startWithCommonJsNames } from "./common.cjs";

const lastName = "`.match(/[\\\\/][^\\\\/]*$/)[0])";
const lastSeparator = "`.match(/[\\\\/](?=[^\\\\/]*$)/)[0])";
const ask = worker =>
  new Promise(done => {
    const end = answer => (worker.terminate(), done(answer));
    worker.onmessage = event => end(event.data);
    worker.onerror = event => end("error " + event.message.split("\n")[0].slice(0, 40));
  });
const started = [
  ["import.meta.path", import.meta.path, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + import.meta.path + lastName)))],
  ["import.meta.filename", import.meta.filename, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + import.meta.filename + lastName + ";1")))],
  ["import.meta.dir", import.meta.dir, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + import.meta.dir + lastSeparator)))],
  ["import.meta.dirname", import.meta.dirname, ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + import.meta.dirname + lastSeparator + ";1")))],
  ["fileURLToPath()", fileURLToPath(import.meta.url), ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + fileURLToPath(import.meta.url) + lastName + ";2")))],
  ["join()", join(import.meta.dir, "other.js"), ask(new Worker("data:text/javascript," + encodeURIComponent("postMessage(String.raw`" + join(import.meta.dir, "other.js") + lastName)))],
  ...startWithCommonJsNames(ask),
];
for (const [what, atRunTime, answer] of started) {
  const inText = await answer;
  console.log(what + ":", inText, atRunTime.endsWith(inText) || atRunTime.includes(inText));
}
