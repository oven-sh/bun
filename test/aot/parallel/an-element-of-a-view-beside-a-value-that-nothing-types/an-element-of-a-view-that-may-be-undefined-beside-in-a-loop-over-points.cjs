"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const view = new Float64Array([1.5, -2, 0, 4]), show = x => Object.is(x, -0) ? "-0" : typeof x + " " + String(x);
const points = JSON.parse("[[1,2,3],[4.5,5,6],[7,\"8\",9],[1,null,2]]"), matrix = new Float32Array([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 4, 5, 6, 1]), to = new Float32Array(3);
function transform(out, a, m) { var x = a[0], y = a[1], z = a[2], w = m[3] * x + m[7] * y + m[11] * z + m[15]; w = w || 1.0; out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w; out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w; out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14 + more]) / w; return out; }
for (let turn = 0; turn < 3; turn++) for (const p of points) said.push(Array.from(transform(to, p, matrix)).join());
said.push(Array.from(transform(to, points[0], new Float32Array(4))).join());
console.log(said.join("\n"));
