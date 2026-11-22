class Point {
  constructor(public x: number) {}
  size(): number {
    return this.x;
  }
}
class Pair {
  y: number;
  constructor(x: number) {
    this.y = x * 2;
  }
  size(): number {
    return this.y + 1;
  }
}
function Old(this: any, x: number) {
  this.z = x - 1;
}
Old.prototype.size = function () {
  return this.z * 3;
};
const makers: any[] = [Point, Pair, Old];
function run(): number {
  let sum = 0;
  for (let i = 0; i < 30; i++) sum += new makers[i % 3](i).size();
  return sum;
}
console.log(run());
makers[1] = Map;
try {
  console.log(run());
} catch (error) {
  console.log((error as Error).constructor.name);
}
