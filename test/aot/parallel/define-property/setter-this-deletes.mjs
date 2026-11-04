import "node:util";
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", { set(v) { delete this.z; } });
  o.p = 1;
  return String(o.z) + " " + ("z" in o);
}
console.log(String(run()));
console.log(String(run([])));
