// Under: --aot-check=Validate: one address was read under the heap of boxed elements and written as a raw double in one layout of a turn: the builder stopped a right program
// STATISTIC: UnrolledLoopsForIndexingType >= 1
let held = [];
function run() { let s = 0, t = 0.5; for (let c = 0; c < held.length; c++) { s = (s + held[c]) | 0; held[c] = t; s += held[c >> 1]; } return s; }
for (let round = 0; round < 3; round++) for (let length = 0; length < 24; length++) {
  const list = []; for (let i = 0; i < length; i++) list.push(i + 1.5);
  held = list;
  console.log(length, run(), held.join());
}
export {};
