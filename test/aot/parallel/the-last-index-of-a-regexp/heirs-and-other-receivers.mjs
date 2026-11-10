class R extends RegExp { get lastIndex() { return 77; } set lastIndex(v) { throw 1; } }
const r = new R("a", "g"), h = Object.create(/a/g), get = o => o.lastIndex, set = (o, v) => { o.lastIndex = v; };
for (let i = 0; i < 100; i++) { set(r, i); get(r); }
set(h, 5);
const ordinary = { lastIndex: 3, other: 4, third: 5 }, late = { first: 1, second: 2 };
for (let i = 0; i < 100; i++) { set(ordinary, i); set(late, i); set(h, i); }
console.log(JSON.stringify(ordinary), JSON.stringify(late), get(h));
set(h, 5);
console.log(get(r), Object.hasOwn(h, "lastIndex"), get(h), get(Object.getPrototypeOf(h)), get({ lastIndex: 3 }), get([1]), get("s"), get(function () {}));
