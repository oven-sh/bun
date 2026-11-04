// across awaits and yields
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
function* walk(r: Range) { const before = r.pos; yield before; r.pos = hidden<number>("1.5"); yield r.pos + before; yield cut("abcdef", r); }
async function later(r: Range) { const before = r.end; await null; r.end = before + 0.5; await null; return before + ":" + r.end + ":" + cut("abcdef", r); }
const r = new Range(1, 4); (globalThis as any).kept = r;
const first = [...walk(r)].join();
later(r).then(v => console.log(first, "|", v));
