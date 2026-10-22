import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
AsyncResource.bind(target)(0.5, 1, 2, 3, 4);
