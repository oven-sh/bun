// The word on the list that a key is says nothing of the list that is asked.
const below = []; Object.setPrototypeOf(below, ["a", "b"]);
const has = key => key in below;
console.log(has([1]), has(1), has(["a"]), has("a"), has(5), has({ toString() { return "0"; } }));

const object = [];
object.__proto__ = { 1: "x", name: "n" };
const asks = key => key in object;
console.log(asks([1]), asks(1), asks(["name"]), asks(0), asks(true));

function count(list, key) { let n = 0; for (let i = 0; i < 20; i++) n += i in list ? 1 : 0; return n + ([key] in list ? 100 : 0); }
const plain = [1, 2, 3], changed = [1, , 3];
Object.setPrototypeOf(changed, [, 5]);
console.log(count(plain, 1), count(changed, 1), count(plain, 7), count(changed, 7));

const stored = [1, 2];
Object.setPrototypeOf(stored, { get 5() { return "five"; }, set 6(v) { this.length = 0; this.six = v; } });
const read = key => stored[key], write = (key, value) => { stored[key] = value; };
console.log(read([5]), read(5), read([0]));
write([6], "w"); console.log(stored.six, stored.length); write(6, "z"); console.log(stored.six, stored.length);
console.log(delete stored[[0]], delete stored[0], stored.length, [0] in stored, 0 in stored);
