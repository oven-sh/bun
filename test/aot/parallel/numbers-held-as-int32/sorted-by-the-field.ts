// sorted by the field
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const list = hidden<number[]>("[5, 1.5, 3, -2, 1e12, 0, -0.5, 2147483648, 7]").map(v => new Range(v, v + 1));
(globalThis as any).kept = list;
list.sort((a, b) => a.pos - b.pos);
console.log(list.map(r => r.pos).join(), list.map(r => r.end).join(), Math.max(...list.map(r => r.pos)), list.reduce((s, r) => s + r.pos, 0), list.map(r => cut("abcdefghij", r)).join("|"));
