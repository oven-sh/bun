import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  return { made: 1.5 };
}
const result = AsyncLocalStorage.snapshot()(target);
console.log(typeof result, result.made + 1);
