// sums and products of what is read
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const r = new Range(2147483647, 2147483647); (globalThis as any).kept = r;
const s = new Range(-2147483643, 65536); (globalThis as any).other = s;
console.log(r.pos + r.end, r.pos * r.end, r.pos - s.pos, s.end * s.end, s.end * s.end * s.end, -s.pos, r.pos / 2, r.pos % 7, r.pos ** 2, r.pos | 0, r.pos >>> 0, s.pos >>> 0, s.pos >> 1, ~r.pos, cut("x", s));
