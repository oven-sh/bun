declare const console: { log(...values: unknown[]): void };
const given: number[] = [0, 1, -1, 2, 3, 7, 8, 31, 32, 255, -256, 65535, 65537, 1073741824, 2147483647, -2147483648];
type Node = { kind: number; flags: number; pos: number; end: number };
const nodes: Node[] = given.map((x, i) => ({ kind: (x | 0) & 15, flags: x | 0, pos: i * 3, end: i * 3 + ((x | 0) & 7) }));
function byKind(n: Node): number { switch (n.kind) { case 0: return 10; case 1: return 11; case 2: return 12; case 3: return 13; case 7: return 17; case 8: return 18; case 15: return 25; default: return -1; } }
function byFlags(n: Node): string { switch (n.flags) { case 0: return "zero"; case -1: return "all"; case 2147483647: return "most"; case -2147483648: return "least"; case 255: return "byte"; case -256: return "high"; default: return "other"; } }
function byShifted(x: number): number { switch ((x | 0) >> 4) { case 0: return 1; case -1: return 2; case 15: return 3; case -16: return 4; case 4096: return 5; case 134217727: return 6; case -134217728: return 7; default: return 0; } }
function byUnsigned(x: number): number { switch (x >>> 28) { case 0: return 1; case 15: return 2; case 8: return 3; case 7: return 4; case 4: return 5; default: return 0; } }
function shifted(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) { const x = a[i] | 0, u = a[i] >>> 0; s += ((x << 1) >> 3) + "," + ((x >> 1) >> 2) + "," + ((u >>> 1) >>> 3) + "," + ((u >>> 4) & 4294967280) + "," + ((u >>> 1) | (u >>> 2)) + "," + ((u ^ (u >>> 16)) >>> 0) + "," + ((x >> 31) ^ x) + ";"; } return s; }
function spans(all: Node[]): number { let t = 0; for (let i = 0; i < all.length; i++) { const n = all[i]; if (n.pos < n.end && n.kind >= 2 && n.kind <= 8) t += n.end - n.pos; if ((n.flags & 6) !== 0 && n.kind !== 3) t += 100; if (n.flags < 0) t += 1000; } return t; }
for (let turn = 0; turn < 2; turn++) {
    console.log(nodes.map(byKind).join() + " # " + nodes.map(byFlags).join() + " # " + given.map(byShifted).join() + " # " + given.map(byUnsigned).join());
    console.log(shifted(given) + " # " + spans(nodes));
}
