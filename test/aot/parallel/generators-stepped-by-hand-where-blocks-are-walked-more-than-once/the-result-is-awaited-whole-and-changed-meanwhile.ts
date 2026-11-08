type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) sum += (yield i) ?? 0; return "sum " + sum; }
const seen: any[] = [];
function keep(step: unknown) { return { then(resolve: (v: unknown) => void) { seen.push(step); resolve(step); } }; }
async function drive(walk: Walk): Promise<string> { let out = ""; for (let i = 0; i < 12; i++) { const step = walk.next(1); const same = await step; (same as any).value = "awaited " + i; if (step.done) return out + "|" + step.value; out += step.value + ","; } return out; }
async function driveThroughAThenable(walk: Walk): Promise<string> { let out = ""; for (let i = 0; i < 12; i++) { const step = walk.next(1); await keep(step); seen[seen.length - 1].value = "kept " + i; if (step.done) return out + "|" + step.value; out += step.value + ","; } return out; }
let last = "";
for (let round = 0; round < 100; round++) last = (await drive(walkOf(3))) + " " + (await driveThroughAThenable(walkOf(3)));
console.log(last);
