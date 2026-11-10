// STATISTIC: LoopsThatHoldLoopsWrittenOut >= 2
"use strict";
function triangle(rows, rounds) { let sum = 0; for (let round = 0; round < rounds; round++) for (let a = 0; a < 3; a++) for (let b = 0; b <= a; b++) sum += rows[a][b] + round; return sum; }
function once(rows) { let sum = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) sum += rows[a][b]; return sum; }
function cube(cells, rounds) { let sum = 0; for (let round = 0; round < rounds; round++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) sum += cells[a][b][c] * (round + 1); return sum; }
function none(rows, rounds) { let sum = 0, seen = 0; for (let round = 0; round < rounds; round++) for (let a = 0; a < 3; a++) { for (let b = 3; b < 3; b++) sum += rows[a][b]; seen++; } return sum + ":" + seen; }
function down(rows, rounds) { let said = ""; for (let round = 0; round < rounds; round++) for (let a = 2; a >= 0; a--) for (let b = 2; b >= 0; b -= 2) said += rows[a][b]; return said; }
function behind(rows, rounds) { let a = 0, b = 0, sum = 0; for (let round = 0; round < rounds; round++) { for (a = 0; a < 3; a++) for (b = 0; b < 2; b++) sum += rows[a][b]; sum += a * 10 + b; } return sum + ":" + a + ":" + b; }
function caught(rows, rounds) { let sum = 0; for (let round = 0; round < rounds; round++) { try { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { if (a * 3 + b === round) throw new Error("at " + round); sum += rows[a][b]; } } catch (error) { sum += error.message.length * 1000; } } return sum; }
const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]], cells = [[[1, 2], [3, 4]], [[5, 6], [7.5, 8]]];
console.log("SAID " + [triangle(rows, 4), once(rows), cube(cells, 3), none(rows, 3), down(rows, 2), behind(rows, 3), caught(rows, 11)].join(" "));
