// async_hooks.executionAsyncResource() answers a plain object of its own. Where it answered the stream of standard input, a program that calls it held that stream, and with it node:fs and the streams: 1,700 functions where there are 80. The build also read those modules, as for every program that loads node:async_hooks: for this one it lowered 2,300 functions where it lowers 500.
// STATISTIC: ImageFunctionsEmitted <= 300
// STATISTIC: FunctionsLowered <= 800
const { executionAsyncResource } = require("node:async_hooks");
const resource = executionAsyncResource();
console.log(resource === executionAsyncResource(), Object.getPrototypeOf(resource) === Object.prototype, Reflect.ownKeys(resource).length);
