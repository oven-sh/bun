const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Real { ns = Object; get(): any { return this.ns; } }
class Fake { ns = { keys: () => ["fake"] }; get(): any { return this.ns; } }
function noise(): number { return unseen(0); }
function read(kit: Real | Fake, i: number): unknown {
  const f = kit.get().keys;
  let k = 0; for (let j = 0; j < 2; j++) k += j; if (k !== 1) return k;
  return f({ a: 1 }).join();
}
const run = unseen(read);
const real = new Real(), fake = new Fake();
let last: unknown, other: unknown;
for (let r = 0; r < 300; r++) { last = run(real, r); if (r % 50 === 49) other = run(fake, r); }
console.log(String(last), String(other), String(run(fake, 1)), String(run(real, 1)));
