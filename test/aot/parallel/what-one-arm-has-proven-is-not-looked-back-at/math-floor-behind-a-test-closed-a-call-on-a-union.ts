const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Real { ns = Math; get(): any { return this.ns; } }
class Fake { ns = { floor: () => -1 }; get(): any { return this.ns; } }
function noise(): number { return unseen(0); }
function read(kit: Real | Fake, i: number): unknown {
  const f = kit.get().floor;
  if (i < 0) return "never";
  return f(2.5) + f(3.5);
}
const run = unseen(read);
const real = new Real(), fake = new Fake();
let last: unknown, other: unknown;
for (let r = 0; r < 300; r++) { last = run(real, r); if (r % 50 === 49) other = run(fake, r); }
console.log(String(last), String(other), String(run(fake, 1)), String(run(real, 1)));
