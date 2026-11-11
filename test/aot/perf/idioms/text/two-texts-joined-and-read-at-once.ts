// Two texts are joined and every unit of the result is read at once.
import { nextTurns } from "../host.ts";
let sink: unknown;
const words: string[] = JSON.parse('["alpha","bravo","charlie","delta","echo-echo-echo","f"]');
function joinedThenRead(left: string, right: string): number {
  const text = left + right;
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}
function bench(n: number): number {
  let count = 0;
  for (let turn = 0; turn < n; turn++) count += joinedThenRead(words[turn % 6], words[(turn + 1) % 6]);
  return count;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check, typeof sink);
