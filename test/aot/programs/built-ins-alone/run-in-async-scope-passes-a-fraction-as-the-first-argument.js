import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
new AsyncResource("work").runInAsyncScope(target, undefined, 0.5, 1, 2, 3, 4);
