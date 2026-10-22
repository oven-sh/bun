import { nextTurns } from "../host.ts";
function listen(queue) {
  function done(value) {
    return done.queue.length + value;
  }
  function cancel() {
    done.queue = null;
  }
  done.queue = queue;
  done.cancel = cancel;
  return done;
}
const queues = [[1], [1, 2]];
function bench(n) {
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
