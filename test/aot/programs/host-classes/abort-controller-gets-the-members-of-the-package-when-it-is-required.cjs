const before = Object.getOwnPropertyNames(AbortController).sort().join();
const required = require("abort-controller");
console.log(before);
console.log(required === AbortController, Object.getOwnPropertyNames(required).sort().join());
const { AbortController: Controller, AbortSignal: Signal } = required;
console.log(Controller === AbortController, Signal === AbortSignal, required.default === AbortController);
for (const key of ["AbortSignal", "default", "AbortController", "prototype"]) console.log(key, typeof required[key]);
console.log(new Controller().signal instanceof Signal);
