const [hook] = Object.getOwnPropertySymbols(Function.prototype);
const kind = { [hook](value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } };
console.log("SAID", process instanceof kind);
