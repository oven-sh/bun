// A function wrapped in a Proxy whose apply trap looks at the arguments and passes them on: a guard round a timer, a spy, a logger.
import { nextTurns } from "../host.ts";
const longest = 2147483647;
function schedule(callback: () => void, delay: number, tag: number): number { return delay + tag + (callback === nothing ? 1 : 0); }
function nothing(): void {}
const guarded: typeof schedule = new Proxy(schedule, {
  apply(target, receiver, list: [() => void, number, number]) {
    if (list[1] > longest) list[1] = longest;
    return Reflect.apply(target, receiver, list);
  },
});
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + guarded(nothing, i & 1023, 3)) | 0;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check);
