"use strict";
function target(a, b) { return (a | 0) + (b | 0); }
function targetRest(...r) { return r.length; }
function viaApplyArguments() { return target.apply(this, arguments); }
function viaSpread(...r) { return target(...r); }
function viaApplyRest(x, ...r) { return targetRest.apply(this, r) + x; }
module.exports = { viaApplyArguments, viaSpread, viaApplyRest };
