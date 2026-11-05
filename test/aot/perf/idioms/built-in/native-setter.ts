import { nextTurns } from "../host.ts";
const signal = new AbortController().signal;
const handlers = [() => {}, () => {}];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    signal.onabort = handlers[i & 1]!;
    s += i & 1;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
