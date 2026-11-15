// minus zero nan and infinity
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const r = new Range(0, 0); (globalThis as any).kept = r;
const said: string[] = [];
for (const v of [-0, NaN, Infinity, -Infinity, 0]) { r.pos = v * hidden<number>("1"); said.push(Object.is(r.pos, v) + " " + 1 / r.pos + " " + cut("abc", r).length); }
console.log(said.join(" | "));
