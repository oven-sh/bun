import { nextTurns } from "../host.ts";
// The plainest form: a function that returns a closure over its parameter, called with written texts; what it returns is kept in constants.
function reader(name: string) {
  return function (from: any) {
    return from[name];
  };
}
function writer(name: string) {
  return function (into: any, value: number) {
    into[name] = value;
  };
}
const readWidth = reader("width"),
  readHeight = reader("height"),
  writeWidth = writer("width");
function bench(n: number): number {
  let s = 0;
  const box = { width: 1, height: 2, depth: 3 };
  for (let i = 0; i < n; i++) {
    writeWidth(box, i & 7);
    s += readWidth(box) + readHeight(box);
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
