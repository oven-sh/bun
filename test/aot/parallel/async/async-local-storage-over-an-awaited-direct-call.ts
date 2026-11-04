// AsyncLocalStorage over an awaited direct call: caller and callee see the store of their run on both sides of every await.
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage<string>();
const log: string[] = [];
async function load(x: number) {
  log.push("load begins in " + storage.getStore());
  await null;
  log.push("load goes on in " + storage.getStore());
  return x;
}
async function run(x: number) {
  log.push("run begins in " + storage.getStore());
  const v = await load(x);
  log.push("run goes on in " + storage.getStore());
  return v;
}
function deed(name: string, x: number) {
  return storage.run(name, () => run(x));
}
const started = [deed("first", 1), deed("second", 2)];
log.push("outside " + storage.getStore());
console.log(String(await started[0]), String(await started[1]));
for (let i = 0; i < 3; i++) console.log(String(await deed("turn " + i, i)));
console.log(log.join(" | "));
