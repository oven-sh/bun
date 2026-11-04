// copies and listings
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const a = new Range(1, 3), b = new Range(1, 3); (globalThis as any).kept = [a, b]; b.end = hidden<number>("3.5");
for (const r of [a, b]) console.log(JSON.stringify(r), JSON.stringify({ ...r }), Object.entries(r).join(";"), Object.values(r).join(), JSON.stringify(structuredClone(r)), JSON.stringify(Object.assign({}, r)), JSON.stringify(Object.getOwnPropertyDescriptor(r, "end")), cut("abcdef", r));
