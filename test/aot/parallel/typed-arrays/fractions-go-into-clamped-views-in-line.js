// Fractions go into a clamped view in a loop. None of them enters the operation of the run time.
// COUNT: operation:operationAOTTypedArrayPut <= 100
const pixels = new Uint8ClampedArray(256), scale = new Float64Array(16); for (let i = 0; i < 16; i++) scale[i] = i / 7;
function shade(out, by, t) { for (let i = 0; i < out.length; i++) out[i] = by[i & 15] * t * 3.5; return out[t & 255]; }
let sum = 0; for (let t = 0; t < 60; t++) sum += shade(pixels, scale, t);
console.log(sum, pixels.join().length);
export {};
