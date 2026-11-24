const held = exports;
Object.setPrototypeOf(held, { [Symbol.hasInstance]: function (value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } });
test("said", () => {});
console.log("SAID", process instanceof held);
