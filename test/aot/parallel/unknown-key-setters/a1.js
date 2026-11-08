import "node:util";
class C {
  z = 0;
}
const KEY = JSON.parse('"p"');
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", {
    set(v) {
      delete this.z;
    },
  });
  o[KEY] = 1.5;
  return JSON.stringify(o.z);
}
console.log("" + run());
try {
  console.log("" + run([]));
} catch (e) {
  console.log(e.name);
}
