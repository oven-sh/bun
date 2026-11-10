// An array that bears the two names comes where the caller expects the family.
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
let sum = 0; for (let i = 0; i < 90; i++) sum += weighed(i % 3 ? new Word(i, i + 1, "w") : through(Object.assign([1, 2], { from: i - 40, to: i })));
tell(() => sum);
console.log(said.join(" | "));
