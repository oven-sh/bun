// emit() reads `events[type]`. Inlined into turn(), the name is known: `data`, which is also a field of a literal of the library.
// `_events` holds a dictionary made by Object.create(null), so no test for that literal's layout stands before the read.
// COUNT: branches <= 330000
import { EventEmitter } from "node:events";
let heard = 0;
const emitters = [new EventEmitter(), new EventEmitter()];
emitters[0].on("data", i => void (heard += i & 1));
emitters[1].on("data", i => void (heard += i & 2));
emitters[1].on("data", i => void (heard += i & 4));
function turn(i) {
  return emitters[i & 1].emit("data", i) ? 1 : 0;
}
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
let answer = 0;
for (let round = 0; round < 4; round++) answer = (answer + bench(5000)) & 0xffffff;
console.log(answer, heard);
