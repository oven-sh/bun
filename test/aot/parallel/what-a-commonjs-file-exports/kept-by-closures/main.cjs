// What a closure keeps of its first call: kept || (kept = require("./x")). The store checks what the variable holds, and reads behind it say so.
// STATISTIC: PrimitiveCalleesTreatedAsThrows >= 3
"use strict";
const getAdd = (() => { let kept; return () => kept || (kept = require("./modules/add.cjs")); })();
function lazy(load) { let value; return () => value ??= load(); }
const getFigures = lazy(() => require("./modules/figures.cjs")), getPoint = (() => { let Point; return () => { if (!Point) Point = require("./modules/point.cjs"); return Point; }; })();
function sums(n) { let s = 0; const o = { n: 3 }; for (let i = 0; i < n; i++) s += getAdd()(o, i); return s; }
function areas(n) { let s = 0; for (let i = 0; i < n; i++) s += getFigures().area(i, 2); return s; }
function points(n) { let s = 0; for (let i = 0; i < n; i++) s += new (getPoint())(i, 1).sum(); return s; }
for (const n of [2, 3, 300]) console.log(sums(n), areas(n), points(n));
console.log(getAdd() === require("./modules/add.cjs"), getFigures() === getFigures(), getPoint().name);
require("./modules/values.cjs");
