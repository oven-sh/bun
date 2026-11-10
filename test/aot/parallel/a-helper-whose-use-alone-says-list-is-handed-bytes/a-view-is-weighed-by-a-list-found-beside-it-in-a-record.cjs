"use strict";
// STATISTIC: ArraysGuardedBesideTypedArrays >= 1
// Both holders come out of a record of which nothing is known. The nest is built once for each kind that the first may be; behind the test for a view, as behind the test for a list, the second is asked for a list of numbers in front, and what is none goes on to a copy in which the first is still what it was found to be.
const steps = JSON.parse('["run"]');
function run(d, t) { const { pixels, kernel, width, height } = d, out = new Float64Array(pixels.length); for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) { let s = 0; for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) s += pixels[(y + ky) * width + x + kx] * kernel[(ky + 1) * 3 + kx + 1]; out[y * width + x] = s + (t & 7); } return out.join(); }
const ops = { run, idle(d, t) { return t; } };
const numbers = Array.from({ length: 20 }, (_, i) => (i * 37) % 251);
const throwing = { valueOf() { throw new RangeError("no number"); } };
const first = () => [Uint8ClampedArray.from(numbers), Uint8Array.from(numbers), Buffer.from(numbers), Float64Array.from(numbers, n => n / 4), Int16Array.from(numbers, n => -n), JSON.parse(JSON.stringify(numbers)), numbers.map(n => n / 4), numbers.map(String), BigInt64Array.from(numbers, BigInt)];
const second = () => [JSON.parse("[0,-1,0,-1,5,-1,0,-1,0]"), JSON.parse("[0.5,-1,0,-1,5,-1,0,-1,0.25]"), [0, -1, , -1, 5, -1, 0, -1, 0], [0, "-1", 0, -1, 5, -1, 0, -1, 0], [0, -1, 0, -1, 5n, -1, 0, -1, 0], [0, -1, 0, -1, throwing, -1, 0, -1, 0], [], Int8Array.from([0, -1, 0, -1, 5, -1, 0, -1, 0]), Float32Array.from([0, -1, 0, -1, 5, -1, 0, -1, 0]), "010151010"];
for (const pixels of first()) for (const kernel of second()) for (let t = 0; t < 2; t++) { const d = Object.assign(JSON.parse('{"width":5,"height":4}'), { pixels, kernel }); let said; try { said = ops[steps[0]](d, t); } catch (e) { said = e.name; } console.log(said); }
