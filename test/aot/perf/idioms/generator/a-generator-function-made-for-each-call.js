import { nextTurns } from "../host.ts";
function first(iterable) {
  const iterator = iterable[Symbol.iterator]();
  const step = iterator.next();
  if (typeof iterator.return === "function") iterator.return();
  return step.value;
}
const list = [3];
const byHand = {
  [Symbol.iterator]() {
    return { next: () => ({ done: false, value: 5 }) };
  },
};
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += first(
      (function* () {
        yield i & 7;
      })(),
    );
    s += first(i & 1 ? list : byHand);
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
