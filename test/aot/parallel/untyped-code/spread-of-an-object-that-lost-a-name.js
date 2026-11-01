// An object that lost a name by delete keeps its other names in order. A copy reads them all at once, and a copy after more changes sees those.
function digest(object) {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join();
}
function make() {
  const made = {};
  for (let i = 0; i < 80; i++) made["k" + i] = i;
  for (let i = 4; i < 80; i++) delete made["k" + i];
  made.a = 1;
  return made;
}
const source = make();
let sum = 0;
for (let i = 0; i < 3000; i++) sum = (sum + Object.keys({ ...source }).length) % 1000003;
console.log(sum, digest({ ...source }));
delete source.k1;
console.log(digest({ ...source }), digest(Object.assign({}, source)));
source.k1 = "back";
source.z = "new";
console.log(digest({ ...source }), digest(Object.assign({ front: 1 }, source)));
delete source.a;
source.a = "again";
source.k0 = "changed";
const { k2, ...rest } = source;
console.log(k2, digest(rest), digest({ ...rest }));
const mark = Symbol("mark");
source[mark] = 1;
source[7] = "seven";
source[3] = "three";
console.log(digest({ ...source }), digest(Object.assign({}, source)));
delete source[3];
delete source[mark];
console.log(digest({ ...source }));
Object.defineProperty(source, "hidden", { value: 1, enumerable: false, configurable: true });
console.log(digest({ ...source }), "hidden" in { ...source });
delete source.hidden;
let asked = 0;
Object.defineProperty(source, "now", { get() { return ++asked; }, enumerable: true, configurable: true });
const taken = { ...source };
console.log(digest(taken), asked, Object.getOwnPropertyDescriptor(taken, "now").value);
delete source.now;
Object.defineProperty(source, "fixed", { value: 1, enumerable: true, writable: false, configurable: false });
const loose = { ...source };
loose.fixed = 2;
console.log(loose.fixed, delete loose.fixed);
const literal = { a: 1, b: 2, c: 3, d: 4, e: 5 };
delete literal.b;
literal.f = 6;
delete literal.a;
console.log(digest({ ...literal }), digest({ ...{ ...literal } }), digest({ x: 0, ...literal, y: 9 }));
const frozen = make();
delete frozen.k0;
Object.freeze(frozen);
const open = { ...frozen };
open.more = 1;
console.log(digest(open), Object.isFrozen(open));
class Holder { p = 1; q = 2; r = 3; }
const instance = new Holder();
delete instance.q;
instance.s = 4;
console.log(digest({ ...instance }), digest(Object.assign({}, instance)));
