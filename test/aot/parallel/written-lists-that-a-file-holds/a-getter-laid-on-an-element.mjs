const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52];
function sum() { let s = 0; for (let i = 0; i < TABLE.length; i++) s += TABLE[i]; return s; }
let reads = 0; say(unseen(sum)()); unseen(Object).defineProperty(unseen(TABLE), 3, { get() { reads++; return 1; } }); say(unseen(sum)(), reads);
