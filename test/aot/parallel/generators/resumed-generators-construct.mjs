// STATISTIC: GeneratorFramesBuilt >= 20
// A generator that constructs is resumed by a return that a new parent of its prototype brings.
const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})())), { next } = engines;
const show = v => JSON.stringify(v, (k, x) => (x === undefined ? "u" : x));
class Point { constructor(x) { this.x = x; } }
function* dates(limit) { for (let i = 0; i < limit; i++) { const date = new Date(i); yield { i, limit }; console.log(+date); } }
function* maps(limit) { for (let i = 0; i < limit; i++) { const map = new Map([[i, "v"], [limit, null]]); yield { i }; console.log(map.get(i), map.size); } }
function* points(limit) { for (let i = 0; i < limit; i++) { const point = new Point(i); yield { i }; console.log(point.x, point instanceof Point); } }
function* errors(limit) { for (let i = 0; i < limit; i++) { const error = new RangeError("e" + i); yield { i }; console.log(error.message, error instanceof RangeError); } }
function* lists(limit) { for (let i = 0; i < limit; i++) { const list = [i, , limit, , ]; yield { i }; console.log(list.length, 1 in list, list[2], Object.keys(list).join()); list.push(i); } }
console.log([() => dates(2), () => maps(2), () => points(2), () => errors(2), () => lists(2)].map(make => make().next().value.i));
function hide(prototype) {
  return { get value() { Object.setPrototypeOf(prototype, Object.assign(Object.create(engines), { ["RETURN".toLowerCase()]: function () { console.log(show(next.call(this)), show(next.call(this))); return {}; } })); return 1; } };
}
const hidden = [hide(dates.prototype), hide(maps.prototype), hide(points.prototype), hide(errors.prototype), hide(lists.prototype)];
function overDates() { for (const v of dates(4)) if (hidden[0].value) return v.i; }
function overMaps() { for (const v of maps(4)) if (hidden[1].value) return v.i; }
function overPoints() { for (const v of points(4)) if (hidden[2].value) return v.i; }
function overErrors() { for (const v of errors(4)) if (hidden[3].value) return v.i; }
function overLists() { for (const v of lists(4)) if (hidden[4].value) return v.i; }
for (let turn = 0; turn < 2; turn++) console.log(overDates(), overMaps(), overPoints(), overErrors(), overLists());
