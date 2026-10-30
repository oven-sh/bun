globalThis.lines = [];
const waiting = new Set();
globalThis.track = (name, promise) => {
  waiting.add(name);
  promise.then(
    () => { waiting.delete(name); lines.push(name + " loaded"); },
    error => { waiting.delete(name); lines.push(name + " rejected " + String(error?.message ?? error).split("\n")[0].replace(/ from .*/, "")); },
  );
};
process.on("uncaughtException", error => lines.push("uncaught " + String(error?.message ?? error).split("\n")[0].replace(/ from .*/, "")));
process.on("exit", () => console.log(lines.sort().join("\n") + "\nnot settled: " + [...waiting].join(", ")));
module.exports = {};
