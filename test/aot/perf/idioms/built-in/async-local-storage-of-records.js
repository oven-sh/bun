import { AsyncLocalStorage } from "node:async_hooks";
import { nextTurns } from "../host.ts";
const sessions = new AsyncLocalStorage();
const others = [new AsyncLocalStorage(), new AsyncLocalStorage()];
const root = { id: 1, name: "root" };
function readStore() {
  return sessions.getStore();
}
let overrides = () => undefined;
function current() {
  return overrides() ?? root;
}
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += current().id + (sessions.getStore()?.id ?? 0);
  return s;
}
let check = 0;
overrides = readStore;
sessions.run({ id: 2, name: "session" }, () =>
  others[0].run(1, () =>
    others[1].run(2, () => {
      for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
    }),
  ),
);
console.log(check);
