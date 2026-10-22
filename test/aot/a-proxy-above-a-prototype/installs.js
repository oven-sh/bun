// <installs> <objects>: keeps so many objects alive, then makes a class so many times, hangs its prototype object under a proxy and constructs a class below it.
const [installs, objects] = process.argv.slice(2).map(Number);
const kept = [];
for (let i = 0; i < objects; i++) kept.push({ i });
function make() {
  class Leaf {}
  Object.setPrototypeOf(Leaf.prototype, new Proxy({}, {}));
  return new (class extends Leaf {})();
}
let made = 0;
for (let i = 0; i < installs; i++) if (make() instanceof Object) made++;
console.log(made + kept.length);
