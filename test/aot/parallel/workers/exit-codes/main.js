// Entry points: ./ends.js ./never-settles.js ./never-settles-after-import.js ./never-settles-after-rejection.js ./rejects-at-top-level.js ./rejects-after-await.js ./rejects-in-microtask.js ./rejects-in-next-tick.js ./rejects-in-timer.js ./rejects-in-immediate.js ./rejects-after-timer.js ./rejects-twice.js ./rejects-with-symbol.js ./rejects-with-undefined.js ./catches-late.js ./throws-at-top-level.js ./throws-in-timer.js ./throws-after-timer.js ./static-import-rejects.js ./static-import-throws.js ./require-rejects.cjs ./require-throws.cjs ./import-rejects.js ./import-rejects-not-awaited.js ./import-rejects-commonjs.js ./import-rejects-with-a-function.js ./import-of-import-rejects.js ./import-throws.js ./import-throws-not-awaited.js ./import-throws-commonjs.js ./import-throws-caught.js ./import-exits.js ./exits-after-import-rejects.js ./rejects-after-import.js ./rejects-after-import-of-loaded-module.js ./rejects-after-import-of-built-in.js ./rejects-after-import-of-json.js ./throws-after-import.js ./unhandled-rejection-listener.js ./unhandled-rejection-listener-import.js ./uncaught-exception-listener-import.js ./global-listeners-import.js ./exit-listener.js ./exit-listener-import.js ./exit-listener-timer.js ./exit-code.js ./exit-code-import.js ./exit-code-timer.js ./starts-worker.js
// Reference: bun build --compile
import { Worker as NodeWorker } from "node:worker_threads";
const summarize = text => (String(text).match(/^\w*[eE]rror: .*$/m) ?? [String(text).split("\n")[0]])[0];
function runWebWorker(name) {
  const { promise, resolve } = Promise.withResolvers();
  const heard = ["web " + name];
  const worker = new Worker(new URL("./" + name, import.meta.url).href);
  worker.addEventListener("open", () => heard.push("open"));
  worker.addEventListener("message", event => heard.push(event.data));
  worker.addEventListener("messageerror", () => heard.push("messageerror"));
  worker.addEventListener("error", event => heard.push(summarize(event.message)));
  worker.addEventListener("close", event => resolve([...heard, "close " + event.code].join(" | ")));
  return promise;
}
function runNodeWorker(name) {
  const { promise, resolve } = Promise.withResolvers();
  const heard = ["node " + name];
  const worker = new NodeWorker(new URL("./" + name, import.meta.url));
  worker.on("online", () => heard.push("online"));
  worker.on("message", message => heard.push(message));
  worker.on("messageerror", () => heard.push("messageerror"));
  worker.on("error", error => heard.push("error: " + (error instanceof Error ? error.message : String(error))));
  worker.on("exit", code => resolve([...heard, "exit " + code].join(" | ")));
  return promise;
}
for (const name of [
  "ends.js",
  "never-settles.js",
  "never-settles-after-import.js",
  "never-settles-after-rejection.js",
  "rejects-at-top-level.js",
  "rejects-after-await.js",
  "rejects-in-microtask.js",
  "rejects-in-next-tick.js",
  "rejects-in-timer.js",
  "rejects-in-immediate.js",
  "rejects-after-timer.js",
  "rejects-twice.js",
  "rejects-with-symbol.js",
  "rejects-with-undefined.js",
  "catches-late.js",
  "throws-at-top-level.js",
  "throws-in-timer.js",
  "throws-after-timer.js",
  "static-import-rejects.js",
  "static-import-throws.js",
  "require-rejects.cjs",
  "require-throws.cjs",
  "import-rejects.js",
  "import-rejects-not-awaited.js",
  "import-rejects-commonjs.js",
  "import-rejects-with-a-function.js",
  "import-of-import-rejects.js",
  "import-throws.js",
  "import-throws-not-awaited.js",
  "import-throws-commonjs.js",
  "import-throws-caught.js",
  "import-exits.js",
  "exits-after-import-rejects.js",
  "rejects-after-import.js",
  "rejects-after-import-of-loaded-module.js",
  "rejects-after-import-of-built-in.js",
  "rejects-after-import-of-json.js",
  "throws-after-import.js",
  "unhandled-rejection-listener.js",
  "unhandled-rejection-listener-import.js",
  "uncaught-exception-listener-import.js",
  "global-listeners-import.js",
  "exit-listener.js",
  "exit-listener-import.js",
  "exit-listener-timer.js",
  "exit-code.js",
  "exit-code-import.js",
  "exit-code-timer.js",
  "starts-worker.js",
]) {
  console.log(await runWebWorker(name));
  console.log(await runNodeWorker(name));
}
