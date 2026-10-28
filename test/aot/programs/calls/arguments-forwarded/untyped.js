"use strict";
function viaApplyArguments(h) { return function () { return h.apply(this, arguments); }; }
function viaApplyRest(h) { return function (...r) { return h.apply(this, r); }; }
function viaSpread(h) { return function (...r) { return h(...r); }; }
function viaSpreadAfterFirst(h) { return function (first, ...r) { return first + "|" + h(...r); }; }
function viaApplyOtherThis(h, t) { return function (...r) { return h.apply(t, r); }; }
function readsAfter(h) { return function (...r) { const x = h.apply(this, r); return x + "|" + r.length + ":" + String(r[0]); }; }
function twice(h) { return function (...r) { return h(...r) + "&" + h(...r); }; }
function inLoop(h) { return function (...r) { let s = ""; for (let i = 0; i < 3; i++) s += h(...r) + ";"; return s; }; }
function inHandler(h) { return function (...r) { try { return h(...r); } catch (e) { return "caught " + e.constructor.name + " " + r.length; } }; }
function inCatch(h) { return function (...r) { try { throw 1; } catch (e) { return h(...r); } }; }
function nested(h) { return viaSpread(viaApplyArguments(viaApplyRest(h))); }
module.exports = { viaApplyArguments, viaApplyRest, viaSpread, viaSpreadAfterFirst, viaApplyOtherThis, readsAfter, twice, inLoop, inHandler, inCatch, nested };
