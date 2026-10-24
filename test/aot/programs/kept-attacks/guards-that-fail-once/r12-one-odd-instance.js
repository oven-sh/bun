// Guards that fail once: one odd instance. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 10000000);
const variant = process.argv[4] ?? "prototype-site";

class A { constructor(n) { this.n = n; } size(k) { return this.n + k; } }
class B { constructor(n) { this.n = n; } size(k) { return this.n + k + 1; } }
class C { constructor(n) { this.n = n; } size(k) { return this.n + k + 2; } }
class D { constructor(n) { this.n = n; } size(k) { return this.n + k + 3; } }
class E { constructor(n) { this.n = n; } size(k) { return this.n + k + 4; } }
class F { constructor(n) { this.n = n; } size(k) { return this.n + k + 5; } }
class G { constructor(n) { this.n = n; } size(k) { return this.n + k + 6; } }
class H { constructor(n) { this.n = n; } size(k) { return this.n + k + 7; } }
class I { constructor(n) { this.n = n; } size(k) { return this.n + k + 8; } }

const [what, where] = variant.split("-");
const odd = new A(0);
if (trip && what === "prototype") Object.setPrototypeOf(odd, { size() { return 0; } });
if (trip && what === "shadow") odd["si" + process.argv[2].replace("trip", "ze")] = () => 0;

function oneClass(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + object.size(i & 7)) | 0;
  return sum;
}
function nineClasses(objects) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + objects[i & 7].size(i & 7)) | 0;
  return sum;
}
const all = [new A(1), new B(1), new C(1), new D(1), new E(1), new F(1), new G(1), new H(1), new I(1)];
console.log(variant, odd.size(1), where === "site" ? oneClass(new A(1)) : nineClasses(all));
