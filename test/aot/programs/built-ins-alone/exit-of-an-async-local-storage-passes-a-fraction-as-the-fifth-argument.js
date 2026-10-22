import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
}
new AsyncLocalStorage().exit(target, 0, 1, 2, 3, 4.5);
