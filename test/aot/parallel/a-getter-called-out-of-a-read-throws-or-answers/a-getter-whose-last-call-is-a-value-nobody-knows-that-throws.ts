const above: any = {};
const held: any = {};
let calls = 0;
held[JSON.parse('"inner"')] = () => { calls++; if (calls % 2) throw new EvalError("odd"); return calls; };
Object.defineProperty(above, "ripe", { get() { return held[JSON.parse('"inner"')](); }, configurable: true });
const orchard: any = Object.create(above);
function look(from: any, key: string, whole: number): string {
  const a = whole * 9 + 4;
  let first: unknown, second: unknown;
  try { first = from.ripe; } catch (error: any) { first = error.constructor.name; }
  try { second = from[key]; } catch (error: any) { second = error.constructor.name; }
  return first + " " + second + " " + a;
}
const turns = JSON.parse("5"), key = JSON.parse('"ripe"');
for (let t = 0; t < turns; t++) console.log(look(orchard, key, t));
