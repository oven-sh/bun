globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("run " + globalThis.runs, (function () { return this === undefined ? "strict" : "sloppy"; })());
