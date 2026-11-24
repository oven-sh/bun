let traps = 0; class Failure extends Error {} class K { constructor(a) { this.a = a; } } class L extends K {} function F() { this.f = 1; } class Bag extends Map {}
class Deep1 {} class Deep2 extends Deep1 {} class Deep3 extends Deep2 {} class Deep4 extends Deep3 {} class Deep5 extends Deep4 {} class Deep6 extends Deep5 {} class Deep7 extends Deep6 {} class Deep8 extends Deep7 {} class Deep9 extends Deep8 {}
const trap = (target) => new Proxy(target, { getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); } });
const usual = [new Map(), [1], new Date(0), new Error("x"), new TypeError("t"), { a: 1 }, 5, "t", null, undefined, () => 1, new K(1), new L(2), new F(), new Failure("f"), Promise.resolve(1), /a/, new Uint8Array(2), Object.create(null), Object.create(new Map()), Object.create(Object.create([])), Symbol.iterator, 10n, new Bag(), new Deep9(), new Deep1()];

const list = []; for (let r = 0; r < 3; r++) for (const u of usual) list.push(u); list.push(Object.setPrototypeOf(new Deep9(), Deep3.prototype)); for (const u of usual) list.push(u);
function count(values) { let s = 0; for (let i = 0; i < values.length; i++) { if (values[i] instanceof Deep9) s += i; else s -= 1; } return s; }
function which(values) { let s = ""; for (const v of values) s += v instanceof Deep9 ? "1" : "0"; return s; }
function each(values) { let s = 0; values.forEach((v, i) => { s += v instanceof Deep9 ? i : 0; }); return s; }
console.log(count(usual), count(list), traps, which(list), traps, each(list), traps);
