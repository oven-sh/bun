import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second) {
  return second;
}
const result = new AsyncLocalStorage().run("store", target, 1, "two");
console.log(typeof result, result.length);
