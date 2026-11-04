// more integers, doubles, booleans and cells are alive at the read that fails than there are registers: some lie in registers that a callee saves, some in others, some in the frame: each arrives as it was
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Kind { flags: number; id: number; constructor(flags: number) { this.flags = flags; this.id = flags + 1; } }
function mix(type: Kind, k: number, d: number, flag: boolean, s: string) {
  const i0 = (k + 1) | 0, i1 = (k * 3) | 0, i2 = (k ^ 21) | 0, i3 = (k << 2) | 0, i4 = (k - 7) | 0, i5 = (k * k) | 0, i6 = (k >> 1) | 0, i7 = (k & 13) | 0, i8 = (k | 64) | 0, i9 = (-k) | 0, i10 = (k + 1000) | 0, i11 = (k * 17) | 0;
  const d0 = d + 0.5, d1 = d * 1.25, d2 = d - 3.75, d3 = d / 8, d4 = d * d, d5 = d + k, d6 = d0 * d1, d7 = d2 - d3, d8 = d4 + 0.125, d9 = d5 * 0.5, d10 = d6 - d7, d11 = d8 / 4;
  const b0 = k > 3, b1 = d < 2, b2 = flag && b0, b3 = !flag, b4 = i2 > i3, b5 = d0 > d1;
  const big0 = k * 4294967296, big1 = k * 1099511627776 + 1;
  const t0 = s + "!", t1 = [k, d], t2 = { k };
  const a = type.flags;
  const b = type.id;
  return [a, b, i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, b0, b1, b2, b3, b4, b5, big0, big1, t0, t1.join("/"), t2.k, s, flag].join(" ");
}
const mixByValue = through(mix);
const other = { flags: "f", id: "i", more: 1 };
console.log(mixByValue(new Kind(1), 5, 1.5, true, "x"));
console.log(mixByValue(other as any, 5, 1.5, true, "x"));
let sum = 0;
for (let i = 0; i < 400; i++) sum += mixByValue(i % 7 ? new Kind(i) : (other as any), i, i / 4, i % 3 === 0, "s" + i).length;
console.log(sum, mixByValue(other as any, -9, -0.25, false, ""));
