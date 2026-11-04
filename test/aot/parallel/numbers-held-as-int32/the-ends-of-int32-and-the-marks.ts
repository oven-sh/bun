// the ends of int32 and the marks
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const r = new Range(0, 0); (globalThis as any).kept = r;
const said: string[] = [];
for (const text of ["2147483647", "2147483648", "-2147483648", "-2147483647", "-2147483646", "-2147483645", "-2147483644", "-2147483643", "-2147483649", "4294967296", "9007199254740991"]) {
  const v = hidden<number>(text); r.pos = v; r.end = v;
  said.push(String(r.pos === v && r.end === v && String(r.pos) === text && "pos" in r && r.pos !== undefined && r.pos !== null) + ":" + (r.pos + 1) + ":" + (r.end - 1));
}
r.pos = 1; r.end = 2;
console.log(said.join(" | "), cut("abc", r));
