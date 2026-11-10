const buffer: any = new (ArrayBuffer as any)(8, { maxByteLength: 8 }), src = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
const evil: any = { valueOf() { buffer.resize(4); return 9; } };
function run(out: Uint8Array, src: Uint8Array, at: number, what: any): string { let turns = 0; for (let i = 0; i < out.length; i++) { out[i] = i === at ? what : src[i]; turns++; } return turns + " " + out.join(); }
const out = new Uint8Array(buffer); let s = ""; for (let r = 0; r < 200; r++) s = run(out, src, -1, 0);
console.log(s, run(out, src, 1, evil));
