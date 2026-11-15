module.exports = file => {
  const worker = new (require("node:worker_threads").Worker)(file, { stdout: true });
  let printed = "";
  let said = "nothing";
  worker.stdout.on("data", chunk => (printed += chunk));
  worker.on("message", message => (said = message));
  worker.on("error", error => (said = "error: " + error.message));
  return new Promise(resolve => worker.on("exit", () => setImmediate(() => resolve(said + " | " + JSON.stringify(printed)))));
};
