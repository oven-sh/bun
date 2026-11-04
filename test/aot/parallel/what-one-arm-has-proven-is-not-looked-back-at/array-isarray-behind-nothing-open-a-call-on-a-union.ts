const unseen = (0, eval)("(x) => x");
class Real { ns = Array; get(): any { return this.ns; } }
class Fake { ns = { isArray: () => "fake" }; get(): any { return this.ns; } }
function noise(): number { return unseen(0); }
function read(kit: Real | Fake, i: number): unknown {
  const f = kit.get().isArray;
  
  return f([]);
}
const run = unseen(read);
const real = new Real(), fake = new Fake();
let last: unknown, other: unknown;
for (let r = 0; r < 300; r++) { last = run(real, r); if (r % 50 === 49) other = run(fake, r); }
console.log(String(last), String(other), String(run(fake, 1)), String(run(real, 1)));
