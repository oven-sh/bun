import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
new AsyncLocalStorage().run("store", target, report);
