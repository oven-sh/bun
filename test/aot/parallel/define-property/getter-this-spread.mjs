import "node:util";
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", { enumerable: true, get() { this.z = 1; return 5; } });
  const copy = { ...o };
  return o.z + copy.p;
}
console.log(String(run()));
console.log(String(run([])));
