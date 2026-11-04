// inherited and overridden
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
class Named extends Range { name: string; constructor(pos: number, end: number, name: string) { super(pos, end); this.name = name; } }
class Shifted extends Range { constructor(pos: number, end: number) { super(pos + 0.5, end); } }
const list: Range[] = [new Named(1, 2, "n"), new Shifted(1, 3), new Range(2, 4), new Named(hidden<number>("1.25"), 4, "m")];
(globalThis as any).kept = list;
console.log(list.map(r => r.pos + ":" + r.end + ":" + cut("abcdef", r) + ":" + r.constructor.name).join(" | "));
