const { hasIn, getFrom, setIn, deleteFrom, Keeper } = require("./lib-calls.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
class Below extends Map { }
class BelowSet extends Set { has(key) { return super.has(key) ? "below" : "not below"; } }
class BelowWeak extends WeakMap { }
const held = { held: 1 }, other = { other: 1 };
const plain = { has(key) { return key === "a"; }, get(key) { return "plain " + typeof key; }, set() { return "plain set"; }, delete() { return "plain delete"; } };
const all = hide([new Map([["a", 1], [held, 2]]), new Set(["a", held]), new WeakMap([[held, 3]]), new WeakSet([held]), new Below([["a", 4]]), new BelowSet(["a"]), new BelowWeak([[held, 5]]), new Keeper(), plain, new URLSearchParams("a=6"), new Map(), new Set(), new Set(["b"]), new WeakMap()]);
const keys = hide(["a", held, "b", other, 7, "a" + JSON.parse("\"\"")]);
const change = (0, eval)(`(function (all) {
    all[1].has = function () { return "own"; };
    Object.setPrototypeOf(all[0], { has() { return "moved"; }, get() { return "moved get"; }, set() { return "moved set"; }, delete() { return "moved delete"; } });
    all[2].get = function (key) { return WeakMap.prototype.get.call(this, key) === 3 ? "own get" : "own miss"; };
    all[3].extra = 1;
    Object.defineProperty(all[10], "get", { get() { return function () { return "through a getter"; }; }, configurable: true });
    Object.setPrototypeOf(all[11], Map.prototype);
    Object.setPrototypeOf(all[7], null);
})`);
const weigh = value => value === undefined ? -1 : value === true ? 11 : value === false ? 5 : typeof value === "number" ? value : typeof value === "string" ? value.length * 3 + value.charCodeAt(0) : typeof value === "object" ? 1000 : -7;
const attempt = (call, one, key, value) => { try { return weigh(call(one, key, value)); } catch (error) { return error instanceof TypeError ? 70000 : 90000; } };
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all);
    const one = all[turn % all.length], key = keys[turn % keys.length];
    sum += attempt(hasIn, one, key) + 3 * attempt(getFrom, one, key);
    if (turn % 5 === 0) sum += 7 * attempt(setIn, one, key, turn & 15);
    if (turn % 11 === 0) sum += 13 * attempt(deleteFrom, one, key);
}
console.log("SAID", sum);
