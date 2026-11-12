function clamp(src: Float64Array, out: Uint8ClampedArray): string { for (let i = 0; i < out.length; i++) out[i] = src[i]; return out.join(); }
function big(src: BigInt64Array, out: BigInt64Array): string { let s = ""; try { for (let i = 0; i < out.length; i++) out[i] = src[i]; } catch (e) { s = (e as Error).name; } return out.join() + " " + s; }
function rest(src: Int32Array, out: Float64Array): string { for (let i = 0; i < out.length; i++) out[i] = src[i] % 3; return out.join() + " " + Object.is(out[1], -0) + " " + Object.is(out[3], NaN); }
let s = ""; for (let r = 0; r < 200; r++) s = clamp(Float64Array.of(1.5, 2.5, -3, 300, NaN, -0), new Uint8ClampedArray(7)) + " " + big(BigInt64Array.of(1n, -2n), new BigInt64Array(2)) + "| " + rest(Int32Array.of(4, -3, 5), new Float64Array(4));
console.log(s, big(BigInt64Array.of(7n), new BigInt64Array(2)));
