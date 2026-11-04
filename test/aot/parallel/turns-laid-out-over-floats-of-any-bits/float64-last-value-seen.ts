function look(value: unknown): string { return typeof value + ":" + String(value) + ":" + Object.is(value, NaN) + ":" + JSON.stringify([value]) + ":" + [value].includes(NaN); }
function run(v: Float64Array): number { let last = 0; for (let i = 0; i < v.length; i++) last = v[i]; return last; }
const lengths = [0, 1, 7, 8, 9, 16, 17, 26];
const kinds = [0x7ff8000000000000n, 0xfff8000000000000n, 0xfffe000012345678n, 0xfffe0000ffffffffn, 0xffff000000000001n, 0x7ff0000000000001n, 0xfff0000000000002n, 0x7fffffffffffffffn, 0xffffffffffffffffn, 0xfffc000000001000n, 0xfffdffff00001000n, 0xfff9000000000006n];
function once(length: number, at: number, bits: bigint): string { const buffer = new ArrayBuffer(length * 8); const raw = new BigUint64Array(buffer); const view = new Float64Array(buffer); for (let i = 0; i < length; i++) view[i] = (i % 9) - 3.5; if (at >= 0 && at < length) raw[at] = bits; return look(run(view)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at < lengths[k]; at++) { let said = ""; for (let b = 0; b < kinds.length; b++) said += once(lengths[k], at, kinds[b]) + " "; console.log(lengths[k], at, said); } }
