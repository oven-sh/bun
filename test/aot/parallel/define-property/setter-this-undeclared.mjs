import "node:util";
class C {}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", { set(v) { this.z = v; } });
  o.p = 1;
  return o.z + " " + ("z" in o) + " " + Object.hasOwn(o, "z") + " " + Object.keys(o).join();
}
console.log(String(run()));
console.log(String(run([])));
