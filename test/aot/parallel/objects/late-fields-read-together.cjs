// STATISTIC: ExtensionReadsGrouped >= 12
// A loop reads several late fields of each object. Some objects have them all, some a few of them, some none.
"use strict";
class Point { constructor(x) { this.x = x; } }
function fill(p, i) { p.a = i; p.b = 1.5; p.c = i; p.d = "d" + (i & 3); p.e = i; p.f = 3.5; p.g = i % 5 ? i : undefined; p.h = null; }
function fillBackwards(p, i) { p.h = i; p.g = 4.5; p.f = i; p.e = 3.5; p.d = i; p.c = 2.5; p.b = i; p.a = 1.5; }
function fillFew(p, i) { if (i & 1) { p.b = i; p.e = 0.25; } else { p.h = i; } }
function build(n) {
    const points = [];
    for (let i = 0; i < n; i++) {
        const p = new Point(i);
        points.push(p);
        if (i % 4 === 0) fill(p, i);
        else if (i % 4 === 1) fillBackwards(p, i);
        else if (i % 4 === 2) fillFew(p, i >> 2);
        if (i % 28 === 0) delete p.c;
    }
    return points;
}
function total(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        sum += (p.a ?? 1) + (p.b ?? 2) + (p.c ?? 3) + (p.e ?? 5) + (p.f ?? 6) + (p.g ?? 7) + (p.h ?? 8);
    }
    return sum;
}
function texts(points) {
    let text = "";
    for (let i = 0; i < points.length; i += 37) { const p = points[i]; text += `${p.a},${p.b},${p.c},${p.d},${p.e},${p.f},${p.g},${p.h};`; }
    return text;
}
function numbers(points) {
    let sum = 0, odd = 0;
    for (const p of points) { const s = p.a + p.b + p.c + p.e + p.f; if (s === s) sum += s; else odd++; }
    return sum + " " + odd;
}
// A store between two reads.
function shift(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const before = p.a ?? 0;
        if (p.b !== undefined) p.c = before + 1;
        sum += (p.c ?? 0) + (p.a ?? 0) + (p.b ?? 0);
    }
    return sum;
}
let changed = 0;
function change(p) { if (p.x % 11 === 0) { p.d = changed++; p.e = undefined; } }
// A call between two reads.
function visit(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const before = p.d;
        change(p);
        if (before !== p.d) sum += p.d;
        sum += (p.e ?? 1) + (p.f ?? 2);
    }
    return sum;
}
function two(points) {
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
        const p = points[i], q = points[i - 1];
        sum += (p.a ?? 0) - (q.a ?? 0) + (p.b ?? 0) * (q.b ?? 0) + (p.c ?? 0) - (q.c ?? 0);
    }
    return sum;
}
const points = build(5000);
for (let round = 0; round < 3; round++) console.log(total(points), numbers(points), shift(points), visit(points), two(points));
console.log(texts(points));
console.log(Object.keys(points[0]).join(), Object.keys(points[1]).join(), Object.keys(points[2]).join(), Object.keys(points[28]).join());
