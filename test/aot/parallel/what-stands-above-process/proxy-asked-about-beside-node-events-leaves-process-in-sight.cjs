// Who only asks whether there is a Proxy makes none: the feature test of many packages costs nothing.
// STATISTIC: ImageFunctionsEmitted <= 520
require("node:events");
console.log(typeof Proxy === "function", Proxy !== undefined);
