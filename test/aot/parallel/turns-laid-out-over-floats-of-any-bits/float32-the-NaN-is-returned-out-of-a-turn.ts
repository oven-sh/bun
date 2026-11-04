function look(value: unknown): string { return typeof value + ":" + String(value) + ":" + Object.is(value, NaN) + ":" + JSON.stringify([value]) + ":" + [value].includes(NaN); }
function run(v: Float32Array): number { for (let i = 0; i < v.length; i++) { if (v[i] !== v[i]) return v[i]; } return -1; }
const lengths = [0, 1, 7, 8, 9, 16, 17, 26];
const kinds = [0x7fc00000, 0xffc00000, 0xffc12345, 0x7f800001, 0xff800002, 0x7fffffff, 0xffffffff, 0xfff00001];
function once(length: number, at: number, bits: number): string { const buffer = new ArrayBuffer(length * 4); const raw = new Uint32Array(buffer); const view = new Float32Array(buffer); for (let i = 0; i < length; i++) view[i] = (i % 9) - 3.5; if (at >= 0 && at < length) raw[at] = bits; return look(run(view)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at < lengths[k]; at++) { let said = ""; for (let b = 0; b < kinds.length; b++) said += once(lengths[k], at, kinds[b]) + " "; console.log(lengths[k], at, said); } }
