// node:worker_threads goes through a value that the build cannot follow. Members that start no Worker are read and called under computed names.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
const threads = unknown(require("node:worker_threads"));
threads[decoded("setEnvironmentData")]("key", "value");
console.log(
  threads[decoded("isMainThread")],
  threads[decoded("getEnvironmentData")]("key"),
  threads[decoded("threadId")],
);
const { port1, port2 } = new threads[decoded("MessageChannel")]();
port2.on("message", message => (console.log("message:", message), port2.close()));
port1.postMessage("through the channel");
