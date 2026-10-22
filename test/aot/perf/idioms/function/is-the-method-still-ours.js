import { nextTurns } from "../host.ts";
const emit = function (step) {
  return (this.count += step);
};
const write = function (step) {
  return (this.count -= step);
};
function Stream() {
  this.count = 0;
}
Stream.prototype.emit = emit;
Stream.prototype.write = write;
function isUntouched(stream) {
  return stream.emit === emit && stream.write === write;
}
const stream = new Stream();
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (isUntouched(stream)) s += i & 3;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
