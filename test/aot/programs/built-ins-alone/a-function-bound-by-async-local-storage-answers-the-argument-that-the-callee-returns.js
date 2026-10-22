import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second) {
  return second;
}
const result = AsyncLocalStorage.bind(target)(1, "two");
console.log(typeof result, result.length);
