// Functions that take a count and a number beside it, in either order, with other parameters between them, and with more of them than there are registers.
// Under: --aot-testing=ForceStraightCompilation: an entry that boxes the count leaves the number as it is
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Point { constructor(x) { this.x = x; } }
function tree(depth, from) { return depth ? { value: from, left: tree(depth - 1, from * 2), right: tree(depth - 1, from * 2 + 1) } : null; }
function names(depth, from) { return depth ? from + "," + names(depth - 1, from * 2) + names(depth - 1, from * 2 + 1) : ""; }
function behind(from, depth) { return depth ? from + ";" + behind(from * 0.5, depth - 1) + behind(from + 0.25, depth - 1) : ""; }
function guarded(point, depth, from) { if (depth === 0) return from; return point.x * point.x + point.x + guarded(point, depth - 1, from * 2 + 1) + guarded(point, depth - 1, from * 0.5); }
function two(depth, first, second) { return depth ? first + "/" + second + " " + two(depth - 1, first * 2, second * 0.5) + two(depth - 1, second - 1, first + 1) : ""; }
function counts(depth, width, from) { return depth ? depth + ":" + width + ":" + from + " " + counts(depth - 1, width + 1, from * 1.5) + counts(depth - 1, width - 1, from * 0.5) : ""; }
function many(depth, a, b, c, d, e, f, g, h) { return depth ? [a, b, c, d, e, f, g, h].join() + " " + many(depth - 1, b * 2, c * 2, d * 2, e * 2, f * 2, g * 2, h * 2, a * 2) + many(depth - 1, a + 0.5, b, c, d, e, f, g, h) : ""; }
report(JSON.stringify(tree(3, 1)));
report(names(3, 1));
report(behind(8, 3));
for (const point of [new Point(1), JSON.parse('{"y":1,"x":1}')]) report(guarded(point, 4, 1) + guarded(point, 3, 7));
report(two(3, 1, 8));
report(counts(3, 2, 1));
report(many(2, 1, 2, 3, 4, 5, 6, 7, 8));
report(names(2, -0) + names(2, 2 ** 53) + names(1, NaN));
