function put(o: Int8Array, u: Uint32Array, f: Float32Array, c: Uint8ClampedArray, src: Int16Array, m: number): string { for (let i = 0; i < m; i++) { o[i] = src[i]; u[i] = src[i]; f[i] = src[i]; c[i] = src[i]; } return [o, u, f, c].join("|"); }
console.log(put(new Int8Array(4).fill(7), new Uint32Array(4).fill(7), new Float32Array(4).fill(7), new Uint8ClampedArray(4).fill(7), Int16Array.of(-1, 300), 4));
// -1,44,0,0|4294967295,300,0,0|-1,300,NaN,NaN|0,255,0,0
