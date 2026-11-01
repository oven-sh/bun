import "node:util";
const key = Symbol();
class C {
  z = 0;
}
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, key, { set(v) { this.z = v; } });
  o[key] = 1;
  return o.z;
}
console.log(String(run()));
console.log(String(run([])));
