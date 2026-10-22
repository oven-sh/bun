import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
let state = 0;
function target() {
  state = "changed";
}
new AsyncResource("work").runInAsyncScope(target, undefined);
console.log(typeof state, state.length);
