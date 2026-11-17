// many objects few misfits
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const list: Range[] = []; const odd = hidden<number>("0.5");
for (let i = 0; i < 20000; i++) list.push(new Range(i, i + (i % 1000 === 999 ? odd : 1)));
(globalThis as any).kept = list;
let sum = 0, cuts = 0; for (const r of list) { sum += r.end - r.pos; cuts += cut("0123456789".repeat(10), new Range(r.pos % 90, r.pos % 90 + 3)).length; }
console.log(sum, cuts, list[999].end, list[1000].end, list[19999].end);
