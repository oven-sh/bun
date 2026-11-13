"use strict";
// (No guard stands for a list that is drawn from use any more: what is held here are the answers.)
// `c.length - 1` stands in front of the loop that counts down. Left to a guess of its own its ways rejoin: the counter begins as a double and the sum as a box. So the guard keeps its word on a parameter that is used outside the loops.
const key = JSON.parse('"horner"');
const methods = {
  horner(c, x) { let s = 0; for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i]; return s; },
  taken(c, x) { let s = 0; for (let i = 0, n = c.length; i < n; i++) s = s * x + c[i]; return s; },
  first(c, x) { let s = c[0]; for (let i = 1; i < c.length; i++) s = s * x + c[i]; return s; },
  down(c, x) { let s = 0, i = c.length; while (i-- > 0) s = s * x + c[i]; return s; },
};
const given = [[1.5, 2, 3.25, 4], [], [7], [1, , 3], new Uint8Array([1, 2, 3]), Buffer.from([4, 5, 6]), new Float64Array([0.5, 1.5]), "123", { length: 2, 0: 5, 1: 6 }, ["a", "b"]];
for (const name of [key, "taken", "first", "down"]) for (const c of given) for (let turn = 0; turn < 3; turn++) console.log(name, String(methods[name](c, 2)));
