// answers: without-library
// # A pattern that is written for one call, of a method of a receiver of which nothing is known: the call goes by the class of the receiver, with the one object that all evaluations share.
// # A string hands it to nobody. For every other receiver the stub makes an object of its own first, so each evaluation has another one, as it was made. In tail position the stub that is tried in front of the read takes the shared object, and the pattern is made where that stub leaves the call as it is written. A sticky pattern, and one that a variable holds, are made at each evaluation.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 59 of 59 of 59
// # CHECK-NEXT: exited with 0
// # RUN(SHARED): bytes f3:Body mechanisms=all
// # SHARED-NOT: NewRegExpLiteral
// # SHARED: Call Stub CallMethodOfBuiltinClassAtSiteWithSharedPattern.StringReplace count 2
// # SHARED-NOT: NewRegExpLiteral
// # RUN(STICKY): bytes f4:Body mechanisms=all
// # STICKY: Call Stub CallMethodOfBuiltinClassAtSite.StringReplace count 2
// # STICKY: NewRegExpLiteral
// # RUN(SPLIT): bytes f5:Body mechanisms=all
// # SPLIT-NOT: NewRegExpLiteral
// # SPLIT: Call Stub CallMethodOfBuiltinClassAtSiteWithSharedPattern.StringSplit count 1
// # SPLIT-NOT: NewRegExpLiteral
// # RUN(TAIL): bytes f1:Body mechanisms=all
// # TAIL: Call Stub TryCallMethodOfBuiltinClass.StringReplace count 2
// # TAIL: NewRegExpLiteral
// # RUN(PARTS): bytes f6:Body mechanisms=all
// # PARTS: Call Stub TryCallMethodOfBuiltinClass.StringSplit count 1
// # PARTS: NewRegExpLiteral
// # RUN(STUCK): bytes f7:Body mechanisms=all
// # STUCK-NOT: Call Stub TryCallMethodOfBuiltinClass
// # STUCK: NewRegExpLiteral
// # RUN(KEPT): bytes f8:Body mechanisms=all
// # KEPT: Call Stub CallMethodOfBuiltinClassAtSite.StringReplace count 2
// # KEPT: NewRegExpLiteral
// # RUN(COPY): bytes f9:Body mechanisms=all
// # COPY-NOT: NewRegExpLiteral
// # COPY: Call Stub CallMethodOfBuiltinClassAtSiteWithSharedPattern.StringReplace count 2
// # COPY-NOT: NewRegExpLiteral
const box = JSON.parse('{"held":null}');
function unknown(value) { box.held = value; return box.held; }
function everyA(x) { const result = x.replace(/a/g, "-"); report(typeof result); return result; }
function stickyA(x) { const result = x.replace(/a/y, "-"); report(typeof result); return result; }
function commas(x) { const result = x.split(/\s*,\s*/); report(typeof result); return result; }
function inTail(x) { return x.replace(/a/g, "+"); }
function partsInTail(x) { return x.split(/,/); }
function stickyInTail(x) { return x.replace(/a/y, "+"); }
function keptA(x) { const pattern = /a/g; const result = x.replace(pattern, "-"); report(pattern.lastIndex); return result; }
function aroundTail(x) { const result = inTail(x); report(typeof result); return result; }
const keeper = unknown({ replace(pattern) { return pattern; }, split(pattern) { return pattern; } });
report(everyA(unknown("banana")));
report(stickyA(unknown("abba")));
report(commas(unknown("p , q,r")).join("|"));
report(keptA(unknown("banana")));
report(inTail(unknown("banana")));
report(partsInTail(unknown("a,b,c")).length);
report(stickyInTail(unknown("aab")));
report(aroundTail(unknown("banana")));
const askers = [everyA, stickyA, commas, keptA, inTail, partsInTail, stickyInTail, aroundTail];
for (let i = 0; i < askers.length; i++) {
  const ask = askers[i];
  const first = ask(keeper), second = ask(keeper);
  report(first === second);
  report(first.source + " " + first.flags + " " + first.lastIndex);
  first.lastIndex = 2; first.mine = 1;
  const third = ask(keeper);
  report(third.lastIndex + " " + third.mine);
}
report(everyA(unknown("banana")));
report(commas(unknown("a,b")).length);
report(inTail(unknown("banana")));
report(partsInTail(unknown("a,b")).length);
report("end");
