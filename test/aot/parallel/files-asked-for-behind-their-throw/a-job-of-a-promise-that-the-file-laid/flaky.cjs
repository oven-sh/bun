globalThis.runs = (globalThis.runs ?? 0) + 1;
if (globalThis.runs === 1)
  Promise.resolve()
    .then(() => require("./flaky.cjs"))
    .catch((error) => { console.log("rejected:", error.message); return require("./flaky.cjs"); })
    .then((answer) => console.log("answered:", answer.value));
if (globalThis.runs < 3) throw new Error("run " + globalThis.runs);
exports.value = globalThis.runs;
