// What a function requires at its first call and keeps: `cached || (cached = require("./x"))`. The value is what the variable holds; a module whose first statement replaces its exports has no other exports, also where modules require one another.
// STATISTIC: CallsInlined >= 40
"use strict";
let add, point, figures, shared, cycle, failing, several, again, nested;
function getAdd() { return add || (add = require("./modules/add.cjs")); }
function getPoint() { return point ??= require("./modules/point.cjs"); }
function getFigures() { if (!figures) figures = require("./modules/figures.cjs"); return figures; }
function getShared() { shared ||= require("./modules/shared.cjs"); return shared; }
function getCycle() { return cycle || (cycle = require("./modules/cycle.cjs")); }
function getFailing() { return failing || (failing = require("./modules/failing.cjs")); }
function getSeveral() { return several || (several = again = require("./modules/add.cjs")); }
function getNested() { let kept; return (function inner() { return kept || (kept = require("./modules/figures.cjs")); })().area; }
const seen = [];
for (let i = 0; i < 300; i++) {
  seen.push(getAdd()(i, 1) + new (getPoint())(i, 2).sum() + getFigures().area(i, 3) + getShared().count() + getSeveral()(i, again(1, 1)) + getNested()(i, 2));
  if (i % 50 === 49) console.log(seen.length, seen.reduce((a, b) => a + b, 0), getPoint().name, typeof getAdd());
}
console.log(getCycle()(3), getCycle().seen, require("./modules/cycle-back.cjs").kind);
for (let i = 0; i < 3; i++) { try { console.log(getFailing()(i)); } catch (e) { console.log(i, e.message); } }
console.log(typeof failing, typeof cycle, add === several, add === again, require("./modules/add.cjs") === add);

require("./modules/stored-calls.cjs");
