class Point {
  x = 1;
  y = 2;
}
class Other {
  a = 100;
  b = 200;
  c = 300;
}
let sum = 0;
for (let i = 0; i < 10; i++) {
  const p = Reflect.construct(Point, [], i & 1 ? Other : Point);
  sum = sum * 3 + p.x + p.y * 10 + Object.keys(p).length * 100 + (Object.getPrototypeOf(p) === Other.prototype ? 1000 : 0) + (p.a === undefined ? 0 : 5000);
  sum %= 1000003;
}
console.log(sum);
