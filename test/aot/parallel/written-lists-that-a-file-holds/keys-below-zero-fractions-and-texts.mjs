const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52];
function at(keys) { let s = ""; for (let i = 0; i < keys.length; i++) s += TABLE[keys[i]] + " "; return s; }
function masked(turns, shift) { let s = 0; for (let i = 0; i < turns; i++) s += TABLE[(i - shift) & 7] + (TABLE[i - shift] | 0); return s; }
say(unseen(at)([0, 7, 8, -1, 1.5, "2", "length", 4294967295, -0]), unseen(masked)(12, 3));
