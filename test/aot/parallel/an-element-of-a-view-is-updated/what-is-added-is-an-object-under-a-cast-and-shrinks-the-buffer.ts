const buffer: any = new (ArrayBuffer as any)(32, { maxByteLength: 64 });
const counts = new Uint32Array(buffer);
function bump(view: Uint32Array, key: number, by: unknown): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const k = key & 7;
  view[k] += by as number;
  return view.length + w;
}
const shrinks = { valueOf() { buffer.resize(4); return 5; } };
const keys: number[] = JSON.parse("[6]");
const first = bump(counts, keys[0], JSON.parse("3"));
const second = bump(counts, keys[0], shrinks);
buffer.resize(32);
console.log("SAID", first, second, Array.from(counts).join(","));
export {};
