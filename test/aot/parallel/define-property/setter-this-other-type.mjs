import "node:util";
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", { set(v) { this.z = "text" + v; } });
  o.p = 1;
  return o.z + 1;
}
console.log(String(run()));
console.log(String(run([])));
