function make() {
  const loop = (n: number): number => (n <= 0 ? 0 : 1 + loop(n - 1));
  return loop;
}
function inner() {
  const walk = function (n: number): number { const step = () => (n > 0 ? walk(n - 1) : 0); return step() + 1; };
  return [walk.name, walk(2)].join(":");
}
console.log(make().name, make()(3), inner());
