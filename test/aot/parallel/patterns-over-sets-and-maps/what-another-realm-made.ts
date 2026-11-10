// A list, a set, a map made in another realm (node:vm) are iterated by that realm's iterators. That realm's prototypes are its
// own: a `return` laid above its iterators is found by a pattern that takes fewer members than there are, and is called.
import vm from "node:vm";
const realm = vm.createContext({});
const made: Record<string, any> = vm.runInContext(`
    globalThis.closes = 0;
    const made = { list: [1, 2, 3], set: new Set([4, 5, 6]), map: new Map([[7, 8], [9, 10], [11, 12]]) };
    for (const name of Object.keys(made))
        Object.getPrototypeOf(made[name][Symbol.iterator]()).return = function () { globalThis.closes++; return {}; };
    made`, realm);
function takeOne(values: any) { const [first] = values; return String(first); }
function takeTwoInLoop(values: any) { let all = ""; for (let turn = 0; turn < 3; turn++) { const [first, second] = values; all += first + "," + second + ";"; } return all; }
function leaveLoopEarly(values: any) { let seen = ""; for (const value of values) { seen += value; break; } return seen; }
for (const name of ["list", "set", "map"]) {
    const before = vm.runInContext("closes", realm);
    const said = takeOne(made[name]) + " " + takeTwoInLoop(made[name]) + " " + leaveLoopEarly(made[name]);
    console.log(name + ": " + said + " closes " + (vm.runInContext("closes", realm) - before));
}

// A realm in which nothing is laid anywhere: its sets and maps are as made there. The pairs that its map hands out are lists of
// THAT realm: they hang below its Array.prototype, not below this one's.
const untouched = vm.createContext({});
const plain: Record<string, any> = vm.runInContext(`({ set: new Set([[1], [2], [3]]), map: new Map([[7, 8], [9, 10], [11, 12]]), listPrototype: Array.prototype })`, untouched);
function firstOf(values: any) { const [first] = values; return first; }
function secondInLoop(values: any) { let last: any; for (let turn = 0; turn < 3; turn++) { const [, second] = values; last = second; } return last; }
for (const pair of [firstOf(plain.map), secondInLoop(plain.map)])
    console.log("a pair of the other realm's map: " + pair.join() + " . of this realm " + (Object.getPrototypeOf(pair) === Array.prototype) + " . of that realm " + (Object.getPrototypeOf(pair) === plain.listPrototype) + " . instanceof Array " + (pair instanceof Array));
for (const member of [firstOf(plain.set), secondInLoop(plain.set)])
    console.log("a member of the other realm's set: " + member.join() + " . of that realm " + (Object.getPrototypeOf(member) === plain.listPrototype));
