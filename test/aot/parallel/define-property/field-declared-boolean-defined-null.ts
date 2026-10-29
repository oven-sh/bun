// A field declared boolean is defined as null in the middle of a loop.
class Point {
  x: number = 1;
  flag: boolean = true;
}
function run(): number {
  const h: Point = new Point();
  let held = 0;
  for (let round = 0; round < 400; round++) {
    if (round === 396) Object.defineProperty(h, "flag", { value: null, writable: true, enumerable: true, configurable: true });
    if (h.flag) held++;
  }
  return held;
}
console.log(run());
