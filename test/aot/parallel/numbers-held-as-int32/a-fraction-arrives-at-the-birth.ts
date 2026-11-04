// a fraction arrives at the birth
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const values = hidden<number[]>("[0.5, 2, 3.75, 4, -0.25, 1e10]");
const list = [new Range(values[0], values[1]), new Range(values[1], values[2]), new Range(values[3], values[4]), new Range(values[5], values[5])];
(globalThis as any).kept = list;
console.log(list.map(r => r.pos + ":" + r.end + ":" + cut("abcdefgh", r)).join(" | "), JSON.stringify(list));
