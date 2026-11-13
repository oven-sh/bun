// An instance of the family whose own field was deleted; the prototype answers by a getter.
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
let asked = 0; const holed = new Word(4, 5, "h"); delete (holed as any).to; Object.defineProperty(Word.prototype, "to", { get() { asked++; return -7; }, configurable: true });
let sum = 0; for (let i = 0; i < 60; i++) sum += weighed(i % 6 ? new Word(i, i + 1, "w") : holed);
tell(() => sum); tell(() => asked);
console.log(said.join(" | "));
