const above: any = {};
let calls = 0;
Object.defineProperty(above, "ripe", { get() { calls++; if (calls > 2) throw new URIError("late"); return calls; }, configurable: true });
const orchard: any = Object.create(above);
function reads(from: any, whole: number): number { const a = whole * 2 + 1; return from.ripe + a; }
function readsByKey(from: any, key: string, whole: number): number { const a = whole * 2 + 1; return from[key] + a; }
const key = JSON.parse('"ripe"'), turns = JSON.parse("3");
for (let t = 0; t < turns; t++) {
  let said: unknown;
  try { said = reads(orchard, t) + readsByKey(orchard, key, t); } catch (error: any) { said = error.constructor.name + ":" + error.message; }
  console.log(said, calls);
}
