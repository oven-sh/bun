// what is no number arrives
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const r = new Range(1, 2); (globalThis as any).kept = r; const any = r as any;
const said: string[] = [];
for (const v of [undefined, null, "7", true, { valueOf() { return 3; } }, [4], 5n, Symbol.for("s")]) { any.pos = v; said.push(typeof r.pos + ":" + (any.pos === v) + ":" + ("pos" in r)); }
any.pos = 1; said.push(cut("abcdef", r));
delete any.end; said.push(String(r.end), String("end" in r), Object.keys(r).join()); any.end = 3; said.push(cut("abcdef", r), Object.keys(r).join());
console.log(said.join(" | "));
