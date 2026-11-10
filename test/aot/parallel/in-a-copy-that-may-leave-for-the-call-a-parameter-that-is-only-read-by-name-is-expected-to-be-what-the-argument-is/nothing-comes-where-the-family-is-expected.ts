// undefined, null and a number come through a cast: the read in the callee throws or answers as in plain.
// STATISTIC: ArgumentSpeculationsPassedToInlinees >= 1
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Leaf { from: number; to: number; sort: number; constructor(from: number, to: number, sort: number) { this.from = from; this.to = to; this.sort = sort; } }
class Word extends Leaf { text: string; constructor(from: number, to: number, text: string) { super(from, to, 80); this.text = text; } }
function isMadeUp(span: any): boolean { return span.from < 0 || span.to < 0; }
function weigh(leaf: Leaf): number { return isMadeUp(leaf) ? 3 : 4; }
(globalThis as any).kept = [weigh, isMadeUp];
const weighed: typeof weigh = (globalThis as any).kept[0];
for (let i = 0; i < 16; i++) tell(() => weighed(i % 4 === 1 ? through(undefined) : i % 4 === 2 ? through(null) : i % 4 === 3 ? through(7) : new Leaf(i - 1, i, 7)));
console.log(said.join(" | "));
