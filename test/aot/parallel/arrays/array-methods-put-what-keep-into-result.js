// slice | concat | splice | filter | map on a receiver that is not an array as it was made: what the method keeps lies in its result: a new array, or what the species constructor has made.
// Each item comes back out of the result and is changed there: another type in a field, a field deleted, a field added. The first holder has to see it.
class Item { constructor(n) { this.n = n; this.tag = "t"; } }
const show = item => typeof item.n + ":" + item.tag + ":" + item.late;
function change(item, i) { if (i % 3 === 0) item.n = "text"; else if (i % 3 === 1) delete item.tag; else item.late = i; return item; }
function named(...items) { const a = items; a.pos = 1; a.end = 2; return a; }            // as TypeScript's NodeArray
function relinked(...items) { return Object.setPrototypeOf(items, Object.create(Array.prototype)); }
const out = [];
for (const make of [named, relinked]) {
  const a = make(new Item(1), new Item(2), new Item(3));
  [a.slice(), a.concat([new Item(4)]), a.filter(() => true), a.map(x => x), a.slice().splice(0, 3)].forEach((r, k) => { r.forEach((x, i) => change(x, i + k)); out.push(Array.isArray(r), r.length, r.pos); });
  out.push(a.map(show).join());
}
// The species constructor keeps what it makes.
let kept;
class Keeping extends Array { static get [Symbol.species]() { return function (n) { kept = { made: n }; return kept; }; } }
const keeping = Keeping.from([new Item(5), new Item(6)]);
for (const r of [keeping.slice(), keeping.filter(() => true), keeping.map(x => x), keeping.concat([new Item(7)])]) { out.push(r === kept, Array.isArray(r), kept.length); change(kept[0], 0); change(kept[1], 1); }
out.push([...keeping].map(show).join());
// It has setters under the indexes.
const caught = [];
class Catching extends Array { static get [Symbol.species]() { return function () { return new Proxy({}, { defineProperty(t, k, d) { caught.push(d.value); return Reflect.defineProperty(t, k, d); } }); }; } }
const catching = Catching.from([new Item(8)]);
catching.slice(); catching.map(x => x); caught.filter(x => x instanceof Item).forEach(change);
out.push(caught.length, show(catching[0]));
// A constructor property of the array's own.
const own = [new Item(9)];
own.constructor = { [Symbol.species]: Object }; const wrapper = own.slice(); out.push(typeof wrapper, Array.isArray(wrapper), show(change(wrapper[0], 0)), show(own[0]));
own.constructor = undefined; out.push(Array.isArray(own.slice()));
own.constructor = { [Symbol.species]: null }; out.push(Array.isArray(own.filter(() => true)));
own.constructor = Object; out.push(Array.isArray(own.map(x => x)));
own.constructor = Map; try { own.slice(); out.push("made"); } catch (error) { out.push(error.constructor.name); }
own.constructor = 5; try { out.push(Array.isArray(own.slice())); } catch (error) { out.push(error.constructor.name); }
// No arrays at all.
const like = { length: 2, 0: new Item(10), get 1() { return second; } }, second = new Item(11);
const fromLike = [Array.prototype.slice.call(like), Array.prototype.filter.call(like, () => true), Array.prototype.map.call(like, x => x), Array.prototype.concat.call(like, like)];
fromLike.forEach((r, k) => out.push(Array.isArray(r), r.length)); change(fromLike[0][0], 0); change(fromLike[1][1], 1); out.push(fromLike[3][0] === like, show(like[0]), show(second));
(function () { const r = Array.prototype.slice.call(arguments); change(r[0], 2); out.push(show(arguments[0])); })(new Item(12));
const spread = { [Symbol.isConcatSpreadable]: true, length: 1, 0: new Item(13) }, closed = [new Item(14)]; closed[Symbol.isConcatSpreadable] = false;
const joined = named().concat(spread, closed, new Item(15)); out.push(joined.length, joined[1] === closed); change(joined[0], 0); change(joined[1][0], 1); out.push(show(spread[0]), show(closed[0]));
console.log(out.join(" "));
