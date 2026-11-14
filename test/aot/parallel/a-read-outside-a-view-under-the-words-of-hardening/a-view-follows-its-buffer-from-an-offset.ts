// Under: --aot-testing=CheckBoundsInEmittersOnly: a read outside a view gives nothing, which is lawful: a hold on a wide integer once met the mark of nothing ahead of the question for it and stopped this right program.
// EVENT: RangeChecksRemoved and AccessesInsideViews, the build in front | 04.29.29; testaot walk: isInsideView | isInBounds
const ints = (): number[] => JSON.parse("[1,2,3,4,5,6,7,8,9,10,11]");
const doubles = (): number[] => JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5]");
const bytes = (): Uint8Array => new Uint8Array(ints());
let calls = 0;
function meddle(buffer: any, to: number, when: number): number { if (++calls === when) buffer.resize(to); return 0; }
function f(v: Uint8Array, buffer: any, to: number, when: number): string {
  let s = "";
  for (let i = 0, n = 0; i + 2 < v.length && n < 12; i += 3, n++) { const a = v[i]; const k = meddle(buffer, to, when); s += a + "," + (v[i + 1]! + k) + "," + v[i + 2] + ";"; }
  return s + v.length;
}
const ways: number[][] = JSON.parse("[[6,1],[6,2],[2,1],[2,3],[4,2],[32,1],[9,2],[16,1]]");
for (let r = 0; r < 3; r++) for (const [to, when] of ways) {
  const buffer = new (ArrayBuffer as any)(16, { maxByteLength: 32 });
  new Uint8Array(buffer).fill(7);
  calls = 0;
  console.log("SAID", to, when, f(new Uint8Array(buffer, 4), buffer, to!, when!), calls);
}
