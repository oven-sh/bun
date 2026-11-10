"use strict";
// STATISTIC: ElementsThatEnterLoopsAskedForNumbers >= 3
// `let m = s[0]; for (..) if (s[i] > m) m = s[i];`: the element read in front of the loop enters it. In the copy for a list of numbers it is asked for a number in front; an empty list, a hole or a text at the first place goes on to the next copy.
const key = JSON.parse('"go"');
const greatest = { go(s) { let m = s[0]; for (let i = 1; i < s.length; i++) if (s[i] > m) m = s[i]; return m; } };
const summed = { go(s) { let t = s[0]; for (let i = 1; i < s.length; i++) t += s[i]; return t; } };
const spread = { go(s) { let low = s[0], high = s[s.length - 1]; for (let i = 0; i < s.length; i++) { if (s[i] < low) low = s[i]; if (s[i] > high) high = s[i]; } return high - low; } };
const given = () => [JSON.parse("[1.5,9.25,-3]"), JSON.parse("[3,1,2]"), [], [, 2, 3], ["a", 1, 2], [1, "b"], [NaN, 1], [-0, 0], [undefined, 4], [null, 4], [{ valueOf() { return 5; } }, 4], [2n, 3n], new Uint8Array([3, 250]), Buffer.from([9, 1]), new Float64Array([0.5, -1]), new Uint8Array(0), "hello", { length: 2, 0: 4, 1: 8 }];
for (const table of [greatest, summed, spread]) for (const s of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = String(table[key](s)); } catch (e) { said = e.name; } console.log(said); }
