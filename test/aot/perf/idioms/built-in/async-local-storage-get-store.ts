import { AsyncLocalStorage } from "node:async_hooks";
import { nextTurns } from "../host.ts";
const sessions = new AsyncLocalStorage<{ id: number }>();
const others = [new AsyncLocalStorage<number>(), new AsyncLocalStorage<number>(), new AsyncLocalStorage<number>()];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += sessions.getStore()!.id + others[2]!.getStore()!;
  return s;
}
let check = 0;
sessions.run({ id: 1 }, () =>
  others[0]!.run(1, () =>
    others[1]!.run(2, () =>
      others[2]!.run(3, () => {
        for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
      }),
    ),
  ),
);
console.log(check);
