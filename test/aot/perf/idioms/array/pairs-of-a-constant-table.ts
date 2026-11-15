import { nextTurns } from "../host.ts";
const steps: number[][] = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]];
function bench(n: number): number {
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const [dx, dy] = steps[i & 15]!;
    x += dx!;
    y += dy!;
  }
  return x + y;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
