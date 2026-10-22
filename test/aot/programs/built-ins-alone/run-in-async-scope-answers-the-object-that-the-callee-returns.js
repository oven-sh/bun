import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  return { made: 1.5 };
}
const result = new AsyncResource("work").runInAsyncScope(target, undefined);
console.log(typeof result, result.made + 1);
