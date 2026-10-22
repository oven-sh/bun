import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof third, third + 1);
}
AsyncLocalStorage.snapshot()(target, 0, 1, 2.5, 3, 4);
