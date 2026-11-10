const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const say = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52];
function sumWithNext() { let s = ""; for (let i = 0; i < TABLE.length; i++) s += TABLE[i] + ":" + TABLE[i + 1] + " "; return s; }
function sumNumbers() { let s = 0; for (let i = 0; i < TABLE.length; i++) s += TABLE[i] * 2 + (TABLE[i + 4] | 0); return s; }
say(unseen(sumWithNext)(), unseen(sumNumbers)());
Reflect[unseen("setPrototypeOf")](unseen(globalThis)[unseen("Object")].getPrototypeOf(unseen([TABLE])[0]) && TABLE, { 8: 1000, 9: 2000, __proto__: Array.prototype });
say(unseen(sumWithNext)(), unseen(sumNumbers)());
