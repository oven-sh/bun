// A function wrapped in a Proxy whose handler has no apply trap: the call goes to the target.
import { nextTurns } from "../host.ts";
function schedule(delay: number, tag: number): number { return delay + tag; }
const watched: typeof schedule = new Proxy(schedule, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } });
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + watched(i & 1023, 3)) | 0;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check);
