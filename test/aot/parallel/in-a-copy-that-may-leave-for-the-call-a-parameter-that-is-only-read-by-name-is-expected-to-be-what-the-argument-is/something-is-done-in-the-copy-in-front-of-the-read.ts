// The callee raises a count in front of its reads: the copy may no longer leave for the call: the count is raised once a call, whatever comes.
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Leaf { from: number; to: number; sort: number; constructor(from: number, to: number, sort: number) { this.from = from; this.to = to; this.sort = sort; } }
class Tally { entered: number; constructor() { this.entered = 0; } }
function isMadeUp(span: any, tally: Tally): boolean { tally.entered++; return span.from < 0 || span.to < 0; }
function weigh(leaf: Leaf, tally: Tally): number { return isMadeUp(leaf, tally) ? 3 : 4; }
(globalThis as any).kept = [weigh, isMadeUp];
const weighed: typeof weigh = (globalThis as any).kept[0];
const tally = new Tally();
let sum = 0; for (let i = 0; i < 90; i++) sum += weighed(i % 3 ? new Leaf(i, i + 1, 1) : through({ to: i - 40, from: 5, sort: 1 }), tally);
tell(() => sum); tell(() => tally.entered);
console.log(said.join(" | "));
