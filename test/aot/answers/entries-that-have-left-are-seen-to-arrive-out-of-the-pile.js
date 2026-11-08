// answers: without-library
// # `order(pile[above], entry)`, `order(top(pile), first)`, `order(Object(stranger), first)`: every caller of `order` is in sight, and what it is handed is null, an entry or some object. The entries have left for unseen code, so beside an object that nobody knows the proof does not name them.
// # What was seen to arrive left them out as well, so nothing was expected of `a` and both reads off it were closed. Entries WERE seen to arrive: they are expected, whoever else has the objects by now.
// # What else arrives fails the test and is read by name: a proxy, an object made below an entry, what a parser made, an accessor, the wrapper of a text and of a number, a list.
// # f2 = order
// # RUN(SEEN): link functions mechanisms=all
// # SEEN: function f2
// # SEEN-NEXT: parameter 0 expected={{*}}L2
// # RUN(TYPED): walk f2 mechanisms=all
// # TYPED-LABEL: code f2:Body
// # TYPED: = GetSlot v0 key="rank" receivers=[L2]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
function lay(pile, entry) { var at = pile.length; pile.push(entry); a: for (; 0 < at; ) { var above = (at - 1) >>> 1, parent = pile[above]; if (0 < order(parent, entry)) (pile[above] = entry), (pile[at] = parent), (at = above); else break a; } }
function top(pile) { return 0 === pile.length ? null : pile[0]; }
function order(a, b) { var gap = a.rank - b.rank; return 0 !== gap ? gap : a.serial - b.serial; }
function tell(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
var pile = new Array(), serial = 0;
function enter(rank, work) { var entry = { serial: serial++, work: work, rank: rank, begun: -1 }; lay(pile, entry); return entry; }
globalThis.enterFromOutside = enter;
var first = enter(5, null);
globalThis.seen = first;
report(order(top(pile), first));
for (var rank = 3; rank < 8; rank++) { enter(rank, null); report(top(pile).rank); }
var asked = [];
var withGetter = Object.defineProperty(JSON.parse('{"serial":1}'), ["ra", "nk"].join(""), { get: function () { asked.push("getter"); return 40; } });
var strangers = [new Proxy(first, { get: function (target, name) { asked.push(String(name)); return 30; } }), Object.create(first), JSON.parse('{"rank":20,"serial":0}'), withGetter, "text", 7, [1, 2]];
for (var which = 0; which < strangers.length; which++) { var stranger = strangers[which]; report(tell(function () { return order(Object(stranger), first); })); }
report(asked.join());
report("end");
