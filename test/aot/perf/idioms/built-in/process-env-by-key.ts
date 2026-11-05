import { nextTurns } from "../host.ts";
// Variables of the environment read by a name out of a list: one that is set and three that are not.
const names: string[] = ["PATH", "AOT_PERF_NEVER_SET_ONE", "AOT_PERF_NEVER_SET_TWO", "AOT_PERF_NEVER_SET_THREE"];
function isSet(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += isSet(names[i & 3]) ? 1 : 0;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
