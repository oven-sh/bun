exports[Symbol.hasInstance] = function (value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; };
test("said", () => {});
console.log("SAID", process instanceof exports);
