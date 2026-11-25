const method = function (value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; };
const kind = new Proxy(function () {}, { get: () => method });
console.log("SAID", process instanceof kind);
