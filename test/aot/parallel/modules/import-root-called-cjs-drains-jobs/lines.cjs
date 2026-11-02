globalThis.lines = [];
const waiting = new Set();
const text = error => String(error?.message ?? error).split("\n")[0];
globalThis.track = (name, promise) => {
  waiting.add(name);
  promise.then(
    () => {
      waiting.delete(name);
      lines.push(name + " loaded");
    },
    error => {
      waiting.delete(name);
      lines.push(name + " rejected: " + text(error));
    },
  );
};
process.on("uncaughtException", error => lines.push("uncaught: " + text(error)));
process.on("exit", () => console.log(lines.join("\n") + "\nnot settled: " + [...waiting].join(", ")));
