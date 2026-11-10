// answers: without-library
// # A row of instances is walked behind six tests of the program's own (null, undefined, typeof, truthiness, instanceof, a tested field), with a stranger in the row each time.
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 205 of 205 of 205
// # CHECK-NEXT: exited with 0
function Crate(label, weight) { this.label = label; this.weight = weight; this.above = null; this.beside = null; this.seals = 0; this.sealsUnder = 0; }
function Chest(label) { Crate.call(this, label, 3); this.lock = 1; }
Chest.prototype = Object.create(Crate.prototype);
var through = (0, eval)("(function (x) { return x; })");
function stack(depth, odd) {
  var at = new Crate("top", 3);
  for (var i = 0; i < depth; i++) {
    var crate = new Crate("c" + i, i % 5);
    crate.above = through(at);
    crate.beside = through(i & 1 ? new Crate("b" + i, 1) : null);
    at = crate;
    if (i === depth >> 1 && odd) { var other = odd(at); if (other !== undefined) at = through(other); }
  }
  return at;
}
function step(crate, seal) { crate.sealsUnder |= seal; var beside = crate.beside; null !== beside && (beside.sealsUnder |= seal); return (3 === crate.weight ? 1 : 0) + crate.label.length; }
function behindNull(from, seal) { var seen = 0; for (var crate = from.above; null !== crate; crate = crate.above) { crate.sealsUnder |= seal; var beside = crate.beside; null !== beside && (beside.sealsUnder |= seal); if (3 === crate.weight) seen++; seen += crate.label.length; } return seen; }
function behindUndefined(from, seal) { var seen = 0; for (var crate = from.above; undefined !== crate && null !== crate; crate = crate.above) { crate.sealsUnder |= seal; if (3 === crate.weight) seen++; seen += crate.label.length; } return seen; }
function behindTypeof(from, seal) { var seen = 0; for (var crate = from.above; "object" === typeof crate && null !== crate; crate = crate.above) { crate.sealsUnder |= seal; if (3 === crate.weight) seen++; seen += crate.label.length; } return seen; }
function behindTruthiness(from, seal) { var seen = 0; for (var crate = from.above; crate; crate = crate.above) { crate.sealsUnder |= seal; if (3 === crate.weight) seen++; seen += crate.label.length; } return seen; }
function behindInstanceof(from, seal) { var seen = 0; for (var crate = from.above; crate instanceof Crate; crate = crate.above) { crate.sealsUnder |= seal; if (3 === crate.weight) seen++; seen += crate.label.length; } return seen; }
function behindField(from, seal) { var seen = 0; for (var crate = from.above; null !== crate; crate = crate.above) { if (crate.weight === 3) { crate.sealsUnder |= seal; seen += crate.label.length; var beside = crate.beside; null !== beside && (beside.seals |= seal); } else seen += crate.seals; } return seen; }
var walks = [behindNull, behindUndefined, behindTypeof, behindTruthiness, behindInstanceof, behindField];
var calls = 0;
var strangers = [
  null,
  function (at) { return { label: "lit", weight: 3, above: at, beside: null, seals: 0, sealsUnder: 0 }; },
  function (at) { return { sealsUnder: 0.5, seals: 0, beside: null, above: at, weight: 3, label: "lit" }; },
  function (at) { return new Proxy(at, { get: function (t, k) { calls++; return t[k]; }, set: function (t, k, v) { calls += 100; t[k] = v; return true; } }); },
  function (at) { Object.freeze(at); },
  function (at) { delete at.sealsUnder; },
  function (at) { delete at.above; },
  function (at) { var kept = 0; Object.defineProperty(at, "sealsUnder", { get: function () { calls++; return kept; }, set: function (v) { calls += 100; kept = v; }, enumerable: true, configurable: true }); },
  function (at) { return Object.create(at); },
  function (at) { var chest = new Chest("chest"); chest.above = through(at); return chest; },
  function (at) { return 7; },
  function (at) { return "text"; },
  function (at) { at.above = through(undefined); },
  function (at) { at.sealsUnder = through("12"); },
  function (at) { at.sealsUnder = through(2.5); at.weight = through(3.0); },
  function (at) { Object.setPrototypeOf(at, { extra: 1 }); },
  function (at) { at.more = 1; at.evenMore = 2; },
];
function show(leaf) { var line = ""; for (var c = leaf, n = 0; c != null && n < 12; c = c.above, n++) line += String(c.label) + ":" + String(c.sealsUnder) + ":" + Object.keys(Object(c)).length + ","; return line; }
for (var which = 0; which < strangers.length; which++) {
  for (var walk = 0; walk < walks.length; walk++) {
    var leaf = stack(9, strangers[which]);
    var total = 0;
    try { for (var round = 0; round < 12; round++) total += walks[walk](leaf, 1 << (round & 7)); } catch (error) { total = "threw " + error.name; }
    report(which + " " + walk + " " + total + " " + calls);
    report(show(leaf));
  }
}
report("end");
