import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  return { made: 1.5 };
}
const result = new AsyncLocalStorage().exit(target);
console.log(typeof result, result.made + 1);
