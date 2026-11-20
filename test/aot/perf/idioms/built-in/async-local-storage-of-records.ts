import { AsyncLocalStorage } from "node:async_hooks";
import { nextTurns } from "../host.ts";
interface Session { id: number; name: string }
const sessions = new AsyncLocalStorage<Session>();
const others = [new AsyncLocalStorage<number>(), new AsyncLocalStorage<number>()];
const root: Session = { id: 1, name: "root" };
function readStore(): Session | undefined {
  return sessions.getStore();
}
let overrides: () => Session | undefined = () => undefined;
function current(): Session {
  return overrides() ?? root;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += current().id + (sessions.getStore()?.id ?? 0);
  return s;
}
let check = 0;
overrides = readStore;
sessions.run({ id: 2, name: "session" }, () =>
  others[0]!.run(1, () =>
    others[1]!.run(2, () => {
      for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
    }),
  ),
);
console.log(check);
