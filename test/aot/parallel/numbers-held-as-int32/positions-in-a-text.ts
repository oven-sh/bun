// positions in a text
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const text = "the quick brown fox";
const ranges = [new Range(0, 3), new Range(4, 9), new Range(10, 15), new Range(16, 19), new Range(-1, 2), new Range(5, 500)];
(globalThis as any).kept = ranges;
console.log(ranges.map(r => cut(text, r)).join("|"), ranges.map(r => r.end - r.pos).join());
