// The first name throws on what comes: the error and what ran in front of it are as in plain.
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
let steps = ""; const bad = { sort: 80, get from(): number { steps += "f"; throw new RangeError("no from"); }, get to() { steps += "t"; return 1; } };
for (let i = 0; i < 12; i++) tell(() => weighed(i % 4 ? new Word(i, i + 1, "w") : through(bad)));
tell(() => steps);
console.log(said.join(" | "));
