import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
let state = 0;
function target() {
  state = "changed";
}
new AsyncLocalStorage().exit(target);
console.log(typeof state, state.length);
