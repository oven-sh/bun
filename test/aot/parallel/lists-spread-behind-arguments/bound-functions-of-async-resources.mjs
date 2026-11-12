// node:async_hooks: what AsyncResource.bind() gives runs in the scope in which it was bound, with the receiver and the arguments of each call, and puts back what was there, whatever the function does.
import { AsyncResource, AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
function report(...values) { return storage.getStore() + ":" + (this === undefined ? "none" : this.name) + ":" + values.join(); }
function fails() { throw new RangeError("from " + storage.getStore()); }
const bound = storage.run("inner", () => AsyncResource.bind(report));
const boundToReceiver = storage.run("inner", () => AsyncResource.bind(report, "type", { name: "given" }));
const failing = storage.run("inner", () => AsyncResource.bind(fails));
class Mine extends AsyncResource { runInAsyncScope(fn, receiver, ...values) { return "mine:" + values.length; } }
const holder = { name: "holder", bound };
const out = [];
storage.run("outer", () => {
  for (let i = 0; i < 300; i++) { out.length = 0; out.push(bound(i, "a"), holder.bound(), boundToReceiver(i), bound.length, new Mine("m").bind(report)(1, 2, 3)); }
  try { failing(); } catch (error) { out.push(error.message); }
  out.push(storage.getStore());
});
console.log(out.join(" "), storage.getStore());
