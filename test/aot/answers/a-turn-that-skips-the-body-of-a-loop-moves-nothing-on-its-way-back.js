// answers: with-library
// # A loop whose body reads eight lists that are asked in front of it has sixteen values from in front alive in every turn, more than there are
// # registers. Two things then cost every turn, also the turn that skips the body. The counter found no free register at the head of the loop and
// # lived in memory, while registers held values that only the body reads. And the block in which `continue` and the end of the body meet took what
// # the end of the body had left in the registers: the skipping way loaded values that the block neither reads nor hands on, and the way back to the
// # head then loaded again what the head holds, which had stood in those registers all the turn.
// # Now a value that the loop carries round takes the register of the value from in front that the loop reads last, and a block that only leads back
// # to the head of a loop holds what that head holds. The loop had 22 moves.
// # First every turn skips the body, then three turns run it, then all.
// # The directive in front makes the tables variables of a function: as variables of a module they are not asked in front of the loop.
// # f5 = least, the method
// # RUN(MOVES): loops f5:Body mechanisms=all
// # REQUIRES(MOVES): x86_64 as-written
// # MOVES: moves 16,
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
"use strict";
var ROW = [], COL = [], BOX = [], BITS = [];
for (var i = 0; i < 81; i++) { ROW[i] = (i / 9) | 0; COL[i] = i % 9; BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0); }
for (var m = 0; m < 512; m++) { var count = 0; for (var b = m; b; b &= b - 1) count++; BITS[m] = count; }
function Board() { this.rows = []; this.cols = []; this.boxes = []; this.cells = []; for (var i = 0; i < 9; i++) { this.rows[i] = i * 57 & 511; this.cols[i] = i * 31 & 511; this.boxes[i] = i * 23 & 511; } for (i = 0; i < 81; i++) this.cells[i] = 1 + i % 9; }
Board.prototype.candidates = function (cell) { return 511 & ~(this.rows[ROW[cell]] | this.cols[COL[cell]] | this.boxes[BOX[cell]]); };
Board.prototype.least = function least(start) { var best = start & 15; for (var i = 0; i < 81; i++) { if (this.cells[i]) continue; var open = this.candidates(i), count = BITS[open]; if (count < best) best = count; } return best; };
var board = new Board();
function least(start) { return board.least(start); }
var sum = 0;
function all() { for (var t = 0; t < 300; t++) sum = (sum + least(t) * (t + 1)) % 1000003; return sum; }
report(least(10));
report(least(0));
report(all());
board.cells[4] = 0;
board.cells[44] = 0;
board.cells[80] = 0;
report(least(10));
report(least(3));
report(least(0));
report(all());
board.rows[0] = 0;
board.cols[4] = 0;
board.boxes[1] = 0;
report(least(15));
report(all());
for (i = 0; i < 81; i++) board.cells[i] = 0;
report(least(15));
report(least(2));
report(all());
for (i = 0; i < 9; i++) { board.rows[i] = 511 ^ (1 << i); board.cols[i] = 0; board.boxes[i] = 0; }
report(least(15));
report(all());
report("end");
