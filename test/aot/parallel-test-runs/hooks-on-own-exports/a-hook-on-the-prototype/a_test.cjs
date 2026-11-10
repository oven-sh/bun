const held = exports;
Object.setPrototypeOf(held, { [Symbol.hasInstance]: function (value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } });
console.log("SAID", process instanceof held);
