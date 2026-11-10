function big(out: BigInt64Array, src: BigInt64Array): string { let s = ""; try { for (let i = 0; i < out.length; i++) out[i] = src[i]; } catch (e) { s = (e as Error).name; } return out.join() + s; }
let runs = 0; const odd: any = { valueOf() { runs++; return 3; } };
function mixed(out: Int32Array, a: any[]): string { for (let i = 0; i < a.length; i++) out[i] = a[i]; return out.join() + " " + runs; }
console.log(big(new BigInt64Array(2), BigInt64Array.of(5n)), mixed(new Int32Array(3), [1.9, undefined, null]), mixed(new Int32Array(2), [odd, "4", odd]));
// 5,0TypeError 1,0,0 0 3,4 2
