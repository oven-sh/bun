const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
function make() { return [3, 10, 17, 24, 31, 38, 45, 52]; }
const FIRST = make(), SECOND = make();
function sumFirst() { let s = 0; for (let i = 0; i < FIRST.length; i++) s += FIRST[i]; return s; }
function sumSecond() { let s = 0; for (let i = 0; i < SECOND.length; i++) s += SECOND[i]; return s; }
say(unseen(sumFirst)(), unseen(sumSecond)()); unseen(FIRST)[0] = 1000; say(unseen(sumFirst)(), unseen(sumSecond)());
