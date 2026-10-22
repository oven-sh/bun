import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
const box = { value: 1 };
function target(holder) {
  holder.value = "text";
}
AsyncLocalStorage.snapshot()(target, box);
console.log(typeof box.value, box.value.length);
