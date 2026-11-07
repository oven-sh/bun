import { nextTurns } from "../host.ts";
const exec = RegExp.prototype.exec;
const invalid = /[^\t\x20-\x7e\x80-\xff]/;
const values: unknown[] = ["text/html; charset=utf-8", "keep-alive", "12", "Thu, 01 Jan 1970 00:00:00 GMT"];
function isInvalid(value: unknown): boolean {
  return exec.call(invalid, value as string) !== null;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += isInvalid(values[i & 3]) ? 0 : 1;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
