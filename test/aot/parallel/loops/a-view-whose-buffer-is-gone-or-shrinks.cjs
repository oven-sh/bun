"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; let s = 0; for (let k = 0; k < V.length; k++) s += V[k][j]; return s; }
const go = hidden(run);
const gone = new Float64Array(4).fill(2.5); const V = [Float64Array.of(1, 2, 3, 4), gone];
said.push(go(V, hidden(1))); structuredClone(gone.buffer, { transfer: [gone.buffer] }); said.push(go(V, hidden(1)), gone.length);
const room = new ArrayBuffer(32, { maxByteLength: 64 }); const tracks = new Float64Array(room); tracks.fill(1.5); const W = [tracks, tracks];
said.push(go(W, hidden(3))); room.resize(16); said.push(go(W, hidden(3)), go(W, hidden(1)));
console.log(said.join(" | "));
