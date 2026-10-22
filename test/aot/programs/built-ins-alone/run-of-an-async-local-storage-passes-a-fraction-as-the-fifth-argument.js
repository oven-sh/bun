import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
}
new AsyncLocalStorage().run("store", target, 0, 1, 2, 3, 4.5);
