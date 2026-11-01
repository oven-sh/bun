import "node:util";
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", { set(v) { this.z = v; } });
  o.p = 1;
  return o.z;
}
console.log(String(run()));
console.log(String(run([])));
