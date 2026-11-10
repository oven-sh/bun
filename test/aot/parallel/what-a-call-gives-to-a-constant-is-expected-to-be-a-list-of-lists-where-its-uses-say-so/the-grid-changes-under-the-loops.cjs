// What the typed loops must notice: a row stored anew in the turn, a row that shrinks and one that grows, the outer counter changed in the inner loop, a getter on the grid, a getter in a row.
"use strict";
function fresh() { return JSON.parse("[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]]"); }
const G = JSON.parse("[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]]");
function refill() { const made = fresh(); G.length = 0; for (const row of made) G.push(row); }
function plain() { let s = 0; for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y].length; x++) s = s + G[y][x]; return s; }
function storesRow() { let s = 0; for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y].length; x++) { s = s + G[y][x]; if (x === 1) G[y] = [100, 200, 300]; } return s; }
function shrinks() { let s = 0; for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y].length; x++) { s = s + G[y][x]; if (x === 1 && y === 2) G[y].length = 2; } return s; }
function grows() { let s = 0; for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y].length; x++) { s = s + G[y][x]; if (G[y].length < 6) G[y].push(1000); } return s; }
function skips() { let s = 0; for (let y = 0; y < G.length; y++) for (let x = 0; x < G[y].length; x++) { s = s + G[y][x]; if (x === 2 && y < 2) y++; } return s; }
const said = [];
for (let round = 0; round < 200; round++) plain();
said.push(plain());
for (const way of [storesRow, shrinks, grows, skips]) { for (let round = 0; round < 3; round++) { refill(); said.push(way()); } said.push(JSON.stringify(G)); refill(); }
let reads = 0;
Object.defineProperty(G, 1, { get() { reads++; return reads & 1 ? [1, 1] : [2, 2, 2]; }, configurable: true });
said.push(plain(), reads);
refill();
Object.defineProperty(G[2], 1, { get() { G[3] = [7]; return 50; } });
said.push(plain(), JSON.stringify(G[3]));
console.log(said.join(" | "));
