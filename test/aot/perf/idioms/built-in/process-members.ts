import { nextTurns } from "../host.ts";
function held(value: unknown, i: number): number {
  return value === undefined ? 0 : i & 1;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += held(process.env, i) + held(process.stdout, i) + held(process.version, i) + held(process.pid, i);
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
