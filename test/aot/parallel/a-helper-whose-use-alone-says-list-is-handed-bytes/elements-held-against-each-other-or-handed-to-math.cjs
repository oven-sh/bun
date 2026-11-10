"use strict";
// STATISTIC: LoopsBuiltForListsAndForBytes >= 4
// `if (s[i] > m) m = s[i]` and `Math.max(m, s[i])` say as much of numbers as a sum does: the loop asks in front for a list, bytes or another view. A relation with a written text says nothing of numbers.
const key = JSON.parse('"go"');
const greatest = { go(s) { let m = s[0]; for (let i = 0; i < s.length; i++) if (s[i] > m) m = s[i]; return m; } };
const least = { go(s) { let m = Infinity; for (let i = 0; i <= s.length; i++) if (m >= s[i]) m = s[i]; return m; } };
const byMath = { go(s) { let m = 0; for (let i = 0; i < s.length; i++) m = Math.max(m, s[i]); return m; } };
const rooted = { go(s) { let t = 0; for (let i = 0; i < s.length; i++) t += Math.floor(Math.sqrt(s[i])); return t; } };
const letters = { go(s) { let c = 0; for (let i = 0; i < s.length; i++) if (s[i] > "m") c++; return c; } };
const given = () => [JSON.parse("[1.5,9.25,-3,9.25,0]"), JSON.parse("[3,1,2]"), [], [1, , 3], [1, "10", 9], ["b", "a", "z"], [2, NaN, 3], [-0, 0], [1n, 2, 3n], [{ valueOf() { return 5; } }, 4], new Uint8Array([3, 250, 7]), Buffer.from([9, 1]), new Float64Array([0.5, -1, NaN]), new Int16Array([-5, 4]), new Float32Array([1.5]), "hello", { length: 2, 0: 4, 1: 8 }, new Uint8Array(0)];
for (const table of [greatest, least, byMath, rooted, letters]) for (const s of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = String(table[key](s)); } catch (e) { said = e.name; } console.log(said); }
