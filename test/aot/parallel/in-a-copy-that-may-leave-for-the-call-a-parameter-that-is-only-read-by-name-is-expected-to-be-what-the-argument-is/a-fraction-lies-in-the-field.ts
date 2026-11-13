// The fields of the family hold a fraction, NaN, a text and an object with valueOf through casts: the compare in the copy answers as in plain.
// STATISTIC: ArgumentSpeculationsPassedToInlinees >= 1
const outside: any = JSON.parse("{}");
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Leaf { from: number; to: number; sort: number; constructor(from: number, to: number, sort: number) { this.from = from; this.to = to; this.sort = sort; } }
class Word extends Leaf { text: string; constructor(from: number, to: number, text: string) { super(from, to, 80); this.text = text; } }
function isMadeUp(span: any): boolean { return span.from < 0 || span.to < 0; }
function weigh(leaf: Leaf): number { return isMadeUp(leaf) ? 3 : 4; }
outside.kept = [weigh, isMadeUp];
const weighed: typeof weigh = through(outside.kept[0]) as typeof weigh;
let turned = 0; const odd: unknown[] = [0.5, NaN, -0, "7", "-7", undefined, -0.25, 2 ** 40, { valueOf() { turned++; return -1; } }];
let sum = ""; for (let i = 0; i < 72; i++) { const word = new Word(i, i + 1, "w"); if (i & 1) (word as any).to = through(odd[(i >> 1) % odd.length]); sum += weighed(word); }
tell(() => sum); tell(() => turned);
console.log(said.join(" | "));
