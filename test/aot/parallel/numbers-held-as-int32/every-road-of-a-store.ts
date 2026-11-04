// every road of a store
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Range { pos: number; end: number; constructor(pos: number, end: number) { this.pos = pos; this.end = end; } }
function cut(text: string, range: Range) { return text.substring(range.pos, range.end); }
const f = hidden<number>("2.5"); const name = hidden<"pos">('"pos"');
const roads: Array<(r: Range) => void> = [
  r => { r.pos = f; }, r => { r[name] = f; }, r => { (r as any)[name] = f; }, r => { Object.assign(r, { pos: f }); }, r => { Reflect.set(r, "pos", f); }, r => { Reflect.set(r, name, f); },
  r => { Object.defineProperty(r, "pos", { value: f, writable: true, enumerable: true, configurable: true }); }, r => { Object.defineProperties(r, { pos: { value: f, writable: true, enumerable: true, configurable: true } }); },
  r => { ({ pos: r.pos } = { pos: f }); }, r => { [r.pos] = [f]; }, r => { r.pos += 1.5; }, r => { r.pos /= 0.4; }, r => { r.pos ||= f; r.pos &&= f; }, r => { for (r.pos of [f]); }, r => { for (const k in { pos: 1 }) (r as any)[k] = f; },
];
console.log(roads.map(road => { const r = new Range(1, 4); (globalThis as any).kept = r; road(r); return r.pos + ":" + cut("abcdefgh", r) + ":" + JSON.stringify(r); }).join(" | "));
