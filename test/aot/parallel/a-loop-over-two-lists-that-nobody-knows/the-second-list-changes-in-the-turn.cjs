"use strict";
// STATISTIC: ListsAskedForBesideListsInFrontOfLoops >= 1
// What was asked in front of the loop holds only as long as nothing in a turn changes it.
var names = JSON.parse('["first","second","odd"]'), world = globalThis;
var tools = {
  scale() { const x = world[names[0]], y = world[names[1]]; let s = 0; for (let i = 0; i < x.length; i++) { y[i] = x[i] * y[i]; s += y[i] * 2; } return s; },
  grow() { const x = world[names[0]], y = world[names[1]]; let s = 0; for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; if (i === 1) y[9] = x[i] * 3; } return s + y.length; },
  same() { const x = world[names[0]], y = world[names[0]]; let s = 0; for (let i = 0; i < x.length; i++) { y[i] = x[i] * 2; s += x[i] * y[i]; } return s; },
  swap() { const x = world[names[0]], y = world[names[1]], odd = world[names[2]]; let s = 0; for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; if (i === 1) y[2] = odd; } return s; },
  shrink() { const x = world[names[0]], y = world[names[1]]; let s = 0; for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; if (i === 1) y.length = 2; } return s; },
};
for (var turn = 0; turn < 3; turn++)
  for (var name in tools)
    for (var odd of [0, "7", { valueOf() { return 8; } }, undefined]) {
      world.first = [0.5, 1.5, 2.5, 3.5]; world.second = [4.5, 5.5, 6.5, 7.5]; world.odd = odd;
      var said = tools[name]();
      if (turn === 2) console.log(name, String(said), JSON.stringify(world.first), JSON.stringify(world.second));
    }
