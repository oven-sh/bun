import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
const box = { value: 1 };
function target() {
  this.value = "text";
}
new AsyncResource("work").runInAsyncScope(target, box);
console.log(typeof box.value, box.value.length);
