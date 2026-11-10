const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52];
function sum() { let s = 0; for (let i = 0; i < TABLE.length; i++) s += TABLE[i]; return s; }
const holder = { list: TABLE };
say(unseen(sum)()); unseen(holder)[unseen("list")][2] = 1000; say(unseen(sum)()); unseen(holder)[unseen("list")][unseen("push")](5); say(unseen(sum)(), TABLE.length);
