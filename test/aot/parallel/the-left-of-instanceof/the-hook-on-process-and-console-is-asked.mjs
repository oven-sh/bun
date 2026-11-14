process[Symbol.hasInstance] = function (value) { return typeof value.Console === "function"; };
console.log("SAID", console instanceof process);
