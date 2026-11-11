import { nextTurns } from "../host.ts";
// Whether a flag was given, asked again and again.
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += hasFlag((i & 1) === 0 ? "--never-given" : "--nor-this") ? 1 : 0;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
