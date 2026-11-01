import "node:util";
const define = Object.defineProperty;
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  define(o, "p", { set(v) { this.z = v; } });
  o.p = 1;
  return o.z;
}
console.log(String(run()));
console.log(String(run([])));
