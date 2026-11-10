Object.defineProperty(module.exports, Symbol.hasInstance, { value: function (value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } });
test("said", () => {});
console.log("SAID", process instanceof module.exports);
