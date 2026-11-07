const hook = Symbol("made up").constructor.hasInstance;
const kind = { [hook](value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } };
console.log("SAID", process instanceof kind);
