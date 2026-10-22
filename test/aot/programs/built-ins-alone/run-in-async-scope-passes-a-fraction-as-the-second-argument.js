import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
new AsyncResource("work").runInAsyncScope(target, undefined, 0, 1.5, 2, 3, 4);
