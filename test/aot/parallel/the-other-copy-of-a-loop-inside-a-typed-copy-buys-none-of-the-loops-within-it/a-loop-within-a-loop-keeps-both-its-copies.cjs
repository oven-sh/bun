// STATISTIC: WalksOfLoops <= 22
"use strict";
// A nest two deep is untouched: the inner loop holds no loop, and keeps its plain walk as its other copy inside the typed copy of the loop around.
const stream = new Uint8Array(300); for (let i = 0; i < stream.length; i++) stream[i] = (i * 37 + 11) & 255;
function tally(turn) { let total = turn & 1, place = 0; while (place + 8 < stream.length) { const length = stream[place] & 31, piece = new Uint8Array(length); for (let i = 0; i < length; i++) piece[i] = stream[place + 4 + (i & 3)] ^ stream[place + (i & 3)]; total += piece.length + (piece[0] ?? 0); place += 4 + length; } return total; }
const said = []; for (let turn = 0; turn < 4; turn++) said.push(tally(turn)); console.log(said.join(" "));
