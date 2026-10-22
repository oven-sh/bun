import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
new AsyncResource("work").runInAsyncScope(target, undefined, box);
console.log(typeof box.value, box.value.length);
