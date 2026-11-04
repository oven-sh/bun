const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
function noise(): number { return unseen(0); }
function read(a: number): unknown {
  const t = a * 2; const u = t < 5; noise(); return u ? 1 : 2;
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(1.5)), String(run(NaN)), String(run(-0)), String(run(2147483647)), String(run(unseen("1") as any)));
