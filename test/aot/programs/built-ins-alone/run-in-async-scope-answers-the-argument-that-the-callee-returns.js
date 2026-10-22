import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second) {
  return second;
}
const result = new AsyncResource("work").runInAsyncScope(target, undefined, 1, "two");
console.log(typeof result, result.length);
