// The length of views that are as made, that have names of their own, that are Buffers, and whose buffers shrink or leave.
class Reader { at = 0; constructor(readonly bytes: Uint8Array) {} need(n: number): boolean { return this.at + n <= this.bytes.length; } sum(): number { let s = 0; for (let i = 0; i < this.bytes.length; i++) s = (s * 31 + this.bytes[i]!) | 0; return s; } }
function length(view: Uint8Array): number { return view.length; }
function total(views: readonly Uint8Array[]): number { let s = 0; for (const view of views) s += view.length; return s; }
const own = new Uint8Array([1, 2, 3]); Object.defineProperty(own, "length", { value: 9 });
const named = new Uint8Array([4, 5]); (named as unknown as { extra: number }).extra = 1;
const resizable = new ArrayBuffer(6, { maxByteLength: 32 }), tracking = new Uint8Array(resizable);
const shared = new Uint8Array(new SharedArrayBuffer(4)), growable = new Uint8Array(new (SharedArrayBuffer as any)(2, { maxByteLength: 16 }) as ArrayBuffer);
class Below extends Uint8Array { get length(): number { return 77; } }
const views: [string, Uint8Array][] = [["made", new Uint8Array([1, 2, 3, 4])], ["own", own], ["named", named], ["buffer", Buffer.from("héllo")], ["tracking", tracking], ["shared", shared], ["growable", growable], ["below", new Below(3)], ["empty", new Uint8Array(0)]];
for (let round = 0; round < 3; round++) {
  for (const [name, view] of views) { const reader = new Reader(view); console.log(name, length(view), reader.need(2), reader.need(5), reader.need(9), reader.sum()); }
  console.log(total(views.map(pair => pair[1])));
  if (round === 0) resizable.resize(2);
  else if (round === 1) { resizable.resize(20); (growable.buffer as unknown as { grow(n: number): void }).grow(8); structuredClone(views[0]![1].buffer, { transfer: [views[0]![1].buffer as ArrayBuffer] }); }
}
export {};
