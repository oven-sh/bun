const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLE = [0.5, -0, NaN, 1e300, -1.25, 3];
function list() { let s = ""; for (let i = 0; i < TABLE.length; i++) s += (Object.is(TABLE[i], -0) ? "-0" : TABLE[i]) + " "; return s; }
function sum() { let s = 0; for (let i = 0; i < TABLE.length; i++) s += TABLE[i] * 2; return s; }
function least() { let m = Infinity; for (let i = 0; i < TABLE.length; i++) if (TABLE[i] < m) m = TABLE[i]; return m; }
say(unseen(list)(), unseen(sum)(), unseen(least)());
