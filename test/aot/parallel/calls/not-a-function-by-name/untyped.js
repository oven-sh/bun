"use strict";
function Holder() {} Holder.prototype.distinctiveName = function (x) { return x + 1; };
function callIt(o) { return o.distinctiveName(1); }
function callItWithMany(o) { return o.distinctiveName(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
function callOnNew(v) { const o = new Holder(); if (v !== "keep") o.distinctiveName = v; return o.distinctiveName(1); }
function readThenCall(o) { const f = o.distinctiveName; return f(1); }
module.exports = { Holder, callIt, callItWithMany, callOnNew, readThenCall };
