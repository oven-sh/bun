import "node:util";
let hits = 0;
class C {
  z = 0;
  bump() {
    hits++;
  }
}
const KEY = JSON.parse('"p"');
function run(given) {
  const o = given ?? new C();
  Object.defineProperty(o, "p", {
    set(v) {
      this.bump();
    },
  });
  o[KEY] = 1;
  return hits;
}
try {
  console.log("" + run());
} catch (e) {
  console.log(e.name + ": " + e.message.slice(0, 40));
}
try {
  console.log("" + run([]));
} catch (e) {
  console.log(e.name);
}
