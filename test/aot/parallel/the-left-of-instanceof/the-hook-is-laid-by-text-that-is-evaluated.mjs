class Kind {}
(0, eval)("(kind, method) => Object.defineProperty(kind, Symbol.hasInstance, { value: method })")(Kind, value => typeof value.allowedNodeEnvironmentFlags.has === "function");
console.log("SAID", process instanceof Kind);
