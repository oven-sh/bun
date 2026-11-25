// The rows are only held against each other and read under `?.`: uses that fit a text as well as a list. The grid itself is read under counters and their sums alone: it is expected to be a list of texts or lists.
"use strict";
const W = 12, H = 10, G = JSON.parse("[" + Array.from({ length: H }, (_, y) => "[" + Array.from({ length: W }, (_, x) => (x * 7 + y * 5) % 11).join() + "]").join() + "]");
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function higher(t) { let s = t & 1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const [dy, dx] of DIRS) { const ny = y + dy, nx = x + dx; if (ny < 0 || nx < 0 || ny >= H || nx >= W) continue; if (G[ny][nx] > G[y][x]) s++; } return s; }
function around(t) { let s = t & 1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s += (G[y - 1]?.[x] ?? 0) + (G[y + 1]?.[x] ?? 0) + (G[y][x - 1] ?? 0) + (G[y][x + 1] ?? 0); return s; }
let sum = 0;
for (let t = 0; t < 200; t++) sum = (sum + higher(t) * 3 + around(t)) % 1000003;
console.log(sum);
