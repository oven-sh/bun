// the list holds a literal at every fifth depth: that frame alone goes on in the slow version, behind its own call, with what the call gave; the frames above and below it stay as they are
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Leaf { weight: number; constructor(weight: number) { this.weight = weight; } }
const log: string[] = [];
function descend(depth: number, leaves: Leaf[]): number {
    if (depth === 0) return 1;
    const below = descend(depth - 1, leaves);
    log.push("back at " + depth);
    const leaf = leaves[depth];
    return (below * 3 + leaf.weight + depth) % 1000003;
}
const descendByValue = through(descend);
const leaves: any[] = [];
for (let i = 0; i <= 400; i++) leaves.push(i % 5 ? new Leaf(i) : { weight: i * 100 });
console.log(descendByValue(400, leaves), log.length, log[0], log[399]);
log.length = 0;
console.log(descendByValue(7, leaves), log.join());
