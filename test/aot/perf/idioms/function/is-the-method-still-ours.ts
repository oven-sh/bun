import { nextTurns } from "../host.ts";
interface Shape {
  count: number;
  emit(step: number): number;
  write(step: number): number;
}
const emit = function (this: Shape, step: number): number {
  return (this.count += step);
};
const write = function (this: Shape, step: number): number {
  return (this.count -= step);
};
function Stream(this: Shape) {
  this.count = 0;
}
Stream.prototype.emit = emit;
Stream.prototype.write = write;
function isUntouched(stream: Shape): boolean {
  return stream.emit === emit && stream.write === write;
}
const stream: Shape = new (Stream as unknown as new () => Shape)();
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (isUntouched(stream)) s += i & 3;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
