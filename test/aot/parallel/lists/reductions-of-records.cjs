// reduce() over records: the accumulator is no element of the list.
// STATISTIC: ArrayStorageLoadsHoisted >= 2
const turns = JSON.parse("40");
const list = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => `{"x":${i / 4 + 0.5},"y":${i},"n":${i % 5}}`).join() + "]");
function products(l) { return l.reduce((a, o) => a + o.x * o.y, 0); }
let s = 0;
for (let t = 0; t < turns; t++) { s += products(list); if (t === 20) list[4].x = "2"; if (t === 25) list[6] = JSON.parse('{"y":1,"x":2,"n":0}'); if (t === 30) Object.defineProperty(list[8], "x", { get() { return 1.25; } }); if (t === 35) delete list[9]; }
console.log(s, products([]), [1, 2, 3].reduce((a, b) => a + b, 0), [1.5, 2].reduce((a, b) => a + b), ["a", "b"].reduce((a, b) => a + b, ""));
