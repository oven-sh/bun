function map(src: Uint8Array, out: Uint8Array, table: Uint8Array): string { for (let i = 0; i < src.length; i++) out[i] = table[src[i]]; return out.join(); }
const short = new Uint8Array(128).fill(3), long = new Uint8Array(256).fill(4); let s = "";
for (let r = 0; r < 200; r++) s = map(Uint8Array.of(65, 66, 0), new Uint8Array(3), short) + " " + map(Uint8Array.of(65, 255), new Uint8Array(3), long);
console.log(s, map(Uint8Array.of(1, 200, 2, 127, 128), new Uint8Array(4).fill(7), short));
