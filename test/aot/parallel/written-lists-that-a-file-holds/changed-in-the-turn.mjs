const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52];
function sumAndPoke(poke) { let s = 0; for (let i = 0; i < TABLE.length; i++) { s += TABLE[i]; poke(i); } return s; }
say(unseen(sumAndPoke)(() => {})); say(unseen(sumAndPoke)((i) => { if (i === 1) unseen(TABLE)[5] = 1000; if (i === 3) unseen(TABLE).push(7); })); say(unseen(sumAndPoke)(() => {}), TABLE.length);
