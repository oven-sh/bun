import { nextTurns } from "../host.ts";
let ran = 0;
function step(value: number): void {
  ran += value;
}
async function bench(n: number): Promise<number> {
  for (let i = 0; i < n; i += 32) {
    for (let j = 0; j < 31; j++) process.nextTick(step, j & 1);
    await new Promise<void>(resolve => process.nextTick(resolve));
  }
  return ran;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += await bench(n);
console.log(check);
