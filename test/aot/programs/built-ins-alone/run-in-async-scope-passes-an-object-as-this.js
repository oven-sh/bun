import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  console.log(typeof this, this.x + 1);
}
new AsyncResource("work").runInAsyncScope(target, { x: 1.5 });
