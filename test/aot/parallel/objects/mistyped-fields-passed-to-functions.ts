// A function takes the fields of an object. A constructor stores a value of another type than the declared one into it.
class Holder {
  large: bigint;
  mode!: number;
  constructor(large: any) {
    this.large = large;
  }
}
function read(holder: any) {
  const modes = new Map([["a", holder.mode]]);
  for (let turn = 0; turn < 3; turn++) {}
  return modes.size;
}
class Point {
  x: number;
  y: number = 2;
  constructor(x: any) {
    this.x = x;
  }
}
function length(point: Point) {
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) sum += point.y;
  return sum;
}
const holders: any[] = [() => new Holder(1n), () => new Holder(NaN), () => new Holder("text")];
for (const make of holders) console.log(read(make()));
const points: any[] = [() => new Point(1), () => new Point("1"), () => new Point({}), () => new Point(undefined)];
for (const make of points) console.log(length(make()));
