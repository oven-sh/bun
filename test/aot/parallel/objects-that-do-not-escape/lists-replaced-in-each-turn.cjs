// STATISTIC: MergedArraysWidened >= 2
// Each turn replaces a list by one whose elements are of other kinds, and only the code behind the loop reads it.
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "f" : typeof v === "object" && v ? Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + Object.keys(v).join() + "}" : String(v));
function lastPair(n, words) { let pair = [0, 1]; for (let i = 0; i < n; i++) pair = [words[i % words.length], i]; return show(pair[0]) + "/" + show(pair[1]); }
function lastOfThree(n) { let held = [1, 2, 3]; for (let i = 0; i < n; i++) held = [i % 2 ? "odd" : null, i / 2, i > 3]; return show(held[0]) + show(held[1]) + show(held[2]) + held.length; }
function swapped(n, a, b) { let left = [a, 0], right = [b, 0]; for (let i = 0; i < n; i++) { const t = left; left = right; right = [t[0], "s" + i]; } return show(left[1]) + show(right[1]) + show(left[0]) + show(right[0]); }
function atLeast(list) { let best = [-1, -Infinity]; for (let i = 0; i < list.length; i++) if (list[i] > 2) best = [String(i), list[i]]; return show(best[0]) + ":" + show(best[1]); }
function tested(n) { let state = [0, undefined]; for (let i = 0; i < n; i++) state = i % 3 === 0 ? [undefined, i] : [{ i }, "t"]; return show(state[0]) + show(state[1]) + (typeof state[0]) + (state[1] === "t"); }
function outer(n, m) { let all = ""; for (let j = 0; j < m; j++) { let row = [j, 0.5]; for (let i = 0; i < n; i++) row = [row[0] + "x", i === 1 ? null : i]; all += show(row[0]) + show(row[1]); } return all; }
function thrown(n, f) { let pair = [0, 0]; try { for (let i = 0; i < n; i++) { pair = ["p" + i, i]; f(i); } } catch (error) { return error.message + show(pair[0]) + show(pair[1]); } return show(pair[0]) + show(pair[1]); }
function handed(n, keep) { let pair = [0, 0]; for (let i = 0; i < n; i++) pair = [i % 2 ? i : "e" + i, true]; keep(pair); return show(pair[0]) + show(pair[1]) + pair.length; }
for (const n of [0, 1, 2, 3, 7, 40]) console.log(n, lastPair(n, ["a", "b", "c"]), lastPair(n, [1.5, -0]), lastPair(n, [null, undefined, {}]), lastOfThree(n), swapped(n, "q", 4), tested(n), outer(n, 2), thrown(n, i => { if (i === 5) throw new Error("five"); }), handed(n, pair => pair.push("more")));
console.log(atLeast([1, 2, 3, 9, 4]), atLeast([]), atLeast([NaN, 2.5]), atLeast(["3", 1]), atLeast([{ valueOf: () => 8 }, 1n, 5n]));
for (let k = 0; k < 200; k++) { lastPair(k % 5, ["w", k]); lastOfThree(k % 4); swapped(k % 3, k, "k"); tested(k % 6); outer(k % 3, 2); }
console.log(lastPair(3, ["a", 7]), swapped(5, [1], {}), outer(3, 3), lastOfThree(2));
let kept = []; for (let k = 0; k < 6; k++) handed(k, pair => { kept.push(pair); if (k > 2) pair[0] = k; }); console.log(kept.map(show).join(""));
