import "node:util";
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", { set(v) { this.added = v; } });
  o.p = 1;
  return o.added + " " + Object.keys(o).join();
}
console.log(String(run()));
console.log(String(run([])));
