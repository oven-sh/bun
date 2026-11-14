// Arrays with boxed storage that hold numbers, sorted by a difference: no comparator runs. NaN, a hole or anything that is no number leaves the array to sort().
const veil = v => JSON.parse("0", () => v);
function boxed(values) { const a = [{}]; a.length = 0; for (const v of values) a.push(v); return a; }
function up(a) { return a.sort((x, y) => x - y); }
function down(a) { return a.sort((x, y) => y - x); }
function written(k) { const a = [5, 3, 9, k & 15, 7, 1, 8, 2]; a.sort((x, y) => y - x); return a; }
function writtenDoubles(k) { const a = [5.5, 3, 9.25, k & 15, -0, 0, 8, 2]; a.sort((x, y) => x - y); return a; }
const text = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "o" + v.k : String(v);
function show(a) { let r = a.length + ":"; for (let i = 0; i < a.length; i++) r += (i in a ? text(a[i]) : "hole") + ","; let h = 0; for (let i = 0; i < r.length; i++) h = (h * 31 + r.charCodeAt(i)) | 0; return h + " " + r.slice(0, 100); }
let calls = 0;
const object = k => ({ k, valueOf() { calls++; return k; } });
const many = n => Array.from({ length: n }, (_, i) => (i * 37) % 101 - (i % 3 === 0 ? 0.5 : 0));
const lists = {
  integers: () => boxed([5, 3, 4, 1, 2, 5, 3]), mixed: () => boxed([2.5, 1, -1, 2147483648, 0.25, 7]), zeros: () => boxed([0, -0, 0, -0, 1, -1, -0]), infinite: () => boxed([Infinity, 1, -Infinity, Infinity, 2]),
  nan: () => boxed([3, NaN, 1, 2, NaN, 0]), nanLast: () => boxed([5, 4, 3, 2, 1, NaN]), hole: () => { const a = boxed([3, 1, 2, 5]); delete a[1]; return a; }, undefinedInside: () => boxed([3, undefined, 1, 2]), nothing: () => boxed([3, null, 1, -2]),
  strings: () => boxed(["3", 1, "2", 10]), objects: () => boxed([3, object(1), 2, object(0)]), objectLast: () => boxed([4, 3, 2, 1, object(2.5)]), truth: () => boxed([true, 3, false, 2]), one: () => boxed([1]), none: () => boxed([]), two: () => boxed([2, 1]),
  frozen: () => Object.freeze(boxed([3, 1, 2])), sealed: () => Object.seal(boxed([3, 1, 2])), closed: () => Object.preventExtensions(boxed([3, 1, 2])), sixtyFour: () => boxed(many(64)), sixtyFive: () => boxed(many(65)), hundred: () => boxed(many(100)), sorted: () => boxed([1, 2, 3, 4, 5, 6, 7, 8, 9]), falling: () => boxed([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]),
  accessor: () => { const a = boxed([3, 1, 2]); Object.defineProperty(a, 1, { get() { return 7; }, set(v) { calls += 10; }, configurable: true, enumerable: true }); return a; }, readOnly: () => Object.defineProperty(boxed([3, 1, 2]), 2, { writable: false }), named: () => { const a = boxed([3, 1, 2]); a.extra = 1; return a; }, small: () => boxed([-5, 3, -1, 2, -5]),
};
for (let turn = 0; turn < 3; turn++) {
  for (const name in lists) for (const f of [up, down]) {
    let said; try { const a = lists[name](); const r = f(a); said = show(a) + " " + (r === a); } catch (e) { said = "threw " + e.constructor.name; }
    console.log(name, f.name, said, name.startsWith("object") ? calls > 0 : calls);
    calls = 0;
  }
  for (const name in lists) { let said; try { said = show(lists[name]().toSorted((x, y) => y - x)); } catch (e) { said = "threw " + e.constructor.name; } console.log(name, "copy", said); calls = 0; }
  for (let k = 0; k < 16; k += 5) console.log(show(written(k)), show(writtenDoubles(k)), show(up(veil([3, 1, 2.5, k]))));
}
