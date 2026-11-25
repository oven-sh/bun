// a fraction arrives after all
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const r = new Range(1, 4); (globalThis as any).kept = r;
const said = [cut("abcdefgh", r)];
r.pos = hidden<number>("1.5"); said.push(String(r.pos), cut("abcdefgh", r), String(r.pos * 2));
r.end = hidden<number>("6.25"); said.push(String(r.end), cut("abcdefgh", r), String(r.end - r.pos));
r.pos = 2; said.push(String(r.pos), cut("abcdefgh", r), JSON.stringify(r), Object.keys(r).join());
console.log(said.join(" | "));
