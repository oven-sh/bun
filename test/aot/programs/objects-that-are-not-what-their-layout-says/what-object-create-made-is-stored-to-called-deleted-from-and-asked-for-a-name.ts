// A variable of type `Point | null` only ever holds null or what Object.create(Point.prototype) made. Behind the test for null its members are stored, called, deleted and asked for through `any`.
class Point {
  x = 1;
  name() {
    return "point " + this.x;
  }
}
let held: Point | null = null;
function store() {
  const it = held;
  if (it === null) return 0;
  (it as any).x = 5;
  (it as any).extra = 6;
  return (it as any).x + (it as any).extra;
}
function call() {
  const it = held;
  if (it === null) return 0;
  return (it as any).name();
}
function remove() {
  const it = held;
  if (it === null) return 0;
  return delete (it as any).x;
}
function has() {
  const it = held;
  if (it === null) return 0;
  return "x" in (it as any);
}
console.log(has(), call(), store(), remove());
held = Object.create(Point.prototype);
console.log(has(), call(), store(), has(), call(), remove(), has(), call());
console.log(new Point().name());
