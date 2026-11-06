import { nextTurns } from "../host.ts";
interface Listener {
  (value: number): number;
  queue: number[] | null;
  cancel: () => void;
}
function listen(queue: number[]): Listener {
  function done(value: number): number {
    return done.queue!.length + value;
  }
  function cancel(): void {
    done.queue = null;
  }
  done.queue = queue as number[] | null;
  done.cancel = cancel;
  return done;
}
const queues = [[1], [1, 2]];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const done = listen(queues[i & 1]);
    s += done(i & 3);
    done.cancel();
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
