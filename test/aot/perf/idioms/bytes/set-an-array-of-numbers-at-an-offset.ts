import { nextTurns } from "../host.ts";
let kept: unknown;
const lists = [[1, 2, 3], [4, 5], [6], [7, 8, 9, 10]];
const view = new Uint8Array(4096);
function bench(n: number): number {
  let written = 0;
  for (let i = 0; i < n; i++) {
    const list = lists[i & 3]!;
    view.set(list, written);
    written += list.length;
    if (written > 4000) written = 0;
  }
  kept = view;
  return written;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
