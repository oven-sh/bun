"use strict";
// STATISTIC: ListsAskedForBesideListsInFrontOfLoops >= 1
// A loop that multiplies the elements of two values asks in front of itself what the first is. Where that is a list of numbers it asks the second for one too.
// Whatever the second is, the sum is the one that `bun <file>` prints.
var names = JSON.parse('["first","second"]'), world = globalThis;
function dot() { const x = world[names[0]], y = world[names[1]]; let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; }
var holed = [1.5, 2.5, 3.5, 4.5]; delete holed[2];
var kinds = {
  halves: [0.5, 1.5, 2.5, 3.5], wholes: [1, 2, 3, 4], mixed: [1, 2.5, -0, NaN], holed, short: [7], empty: [], texts: ["2", "3", "x", ""], bigs: [1n, 2n, 3n, 4n],
  objects: [{ valueOf() { return 5; } }, null, undefined, true], bytes: new Uint8Array([1, 2, 3, 4]), buffer: Buffer.from([5, 6, 7, 8]), clamped: new Uint8ClampedArray([9, 10, 11, 12]),
  doubles: new Float64Array([0.25, -0, NaN, Infinity]), digits: "1234", record: { length: 4, 0: 2, 1: 3, 2: 4, 3: 5 }, getter: { get 0() { return 6; }, length: 4 }, frozen: Object.freeze([1.5, 2.5, 3.5, 4.5]),
};
for (var turn = 0; turn < 3; turn++)
  for (var first in kinds)
    for (var second in kinds) {
      var said;
      world.first = kinds[first]; world.second = kinds[second];
      try { said = dot(); } catch (error) { said = error.name; }
      if (turn === 2) console.log(first, second, Object.is(said, -0) ? "-0" : String(said));
    }
