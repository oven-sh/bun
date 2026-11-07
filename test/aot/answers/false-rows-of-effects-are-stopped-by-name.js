// answers: without-library
// # testing=CheckEffectsAtRunTime (ir/AOTEffectsNet.h): what the rows of effects say that a call does NOT do is held against what it did, and the process stops by name.
// # The lie, testing=RowSaysLess:<kind>/<row>/<part>: one row is taken to say less than it does, by the walk, the sweep and the back end alike. Each kind of row and each part is laid false once.
// # f2 = bump
// # RUN(NET): run-in-shell testing=CheckEffectsAtRunTime mechanisms=all globalThis.report = value => print(String(value));
// # NET: 491
// # NET-NEXT: end
// # NET-NEXT: exited with 0
// # "Runs no other code": a getter behind a read by name, by the row of the operation and by that of the stub; a reviver behind JSON.parse, by the row of the built-in.
// # RUN(OPERATION): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Operation/PropGet/RunsOtherCode mechanisms=all globalThis.report = value => print(String(value));
// # OPERATION: AOT: f{{*}} at {{*}}: the rows of effects of operation:PropGet and of stub:ReadSizeOfTableAtSite say that the call will run no other code, and compiled code was entered. This is a bug in Bun.
// # OPERATION-NOT: end
// # RUN(STUB): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Stub/ReadSizeOfTableAtSite/RunsOtherCode mechanisms=all globalThis.report = value => print(String(value));
// # STUB: AOT: f{{*}} at {{*}}: the rows of effects of operation:PropGet and of stub:ReadSizeOfTableAtSite say that the call will run no other code, and compiled code was entered. This is a bug in Bun.
// # STUB-NOT: end
// # RUN(REVIVER): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Builtin/JSON.parse/RunsOtherCode mechanisms=all globalThis.report = value => print(String(value));
// # REVIVER: AOT: f{{*}} at {{*}}: the rows of effects of operation:CallBuiltin and of built-in:JSON.parse say that the call will run no other code, and compiled code was entered. This is a bug in Bun.
// # REVIVER-NOT: end
// # "Does not write X": a store behind the end of a list, a method that turns its receiver round, a callee that writes a field of its argument.
// # RUN(STORE): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Stub/PutByValCached/ArrayStorage mechanisms=all globalThis.report = value => print(String(value));
// # STORE: AOT: f{{*}} at {{*}}: the rows of effects of operation:ElemSet and of stub:PutByValCached say that the call will not write ArrayStorage, and those words of operand 0 are others behind it. This is a bug in Bun.
// # STORE-NOT: end
// # RUN(METHOD): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Builtin/Array.prototype.reverse/Elements mechanisms=all globalThis.report = value => print(String(value));
// # METHOD: AOT: f{{*}} at {{*}}: the rows of effects of operation:CallBuiltin and of built-in:Array.prototype.reverse say that the call will not write Elements, and those words of operand 0 are others behind it. This is a bug in Bun.
// # METHOD-NOT: end
// # RUN(CALLEE): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Callee/f2/ObjectFields mechanisms=all globalThis.report = value => print(String(value));
// # CALLEE: AOT: f{{*}} at {{*}}: the rows of effects of operation:CallDirect and of what Link says of the callee say that the call will not write ObjectFields, and those words of operand 0 are others behind it. This is a bug in Bun.
// # CALLEE-NOT: end
// # "Throws nothing": whoever looks for a handler asks whether a call is under way that is said so.
// # RUN(THROWS): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Builtin/JSON.parse/Throws mechanisms=all globalThis.report = value => print(String(value));
// # THROWS: AOT: f{{*}} at {{*}}: the rows of effects of operation:CallBuiltin and of built-in:JSON.parse say that the call will throw nothing by a rule of the language, and it threw. This is a bug in Bun.
// # THROWS-NOT: end
// # A row that says "for lack of memory alone" is held to the same.
// # RUN(BYRULE): run-in-shell testing=CheckEffectsAtRunTime,RowSaysLess:Builtin/JSON.parse/ThrowsByRule mechanisms=all globalThis.report = value => print(String(value));
// # BYRULE: AOT: f{{*}} at {{*}}: the rows of effects of operation:CallBuiltin and of built-in:JSON.parse say that the call will throw nothing by a rule of the language, and it threw. This is a bug in Bun.
// # BYRULE-NOT: end
// # "Does not collect": with a collection at every allocation that leaves the free lists.
// # RUN(COLLECTS): run-in-shell --slowPathAllocsBetweenGCs=1 testing=CheckEffectsAtRunTime,RowSaysLess:Builtin/JSON.parse/Collects mechanisms=all globalThis.report = value => print(String(value));
// # COLLECTS: AOT: f{{*}} at {{*}}: the rows of effects of operation:CallBuiltin and of built-in:JSON.parse say that the call will not collect, and the heap was collected. This is a bug in Bun.
// # COLLECTS-NOT: end
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
const bare = JSON.parse('{"size":1}');
const watched = Object.defineProperty(JSON.parse("{}"), "size", { get() { return 2; } });
function read(box) { return box.size; }
const list = JSON.parse("[1,2,3]");
function put(target, at, value) { target[at] = value; return target.length; }
function flip(values) { const first = values[0]; values.reverse(); return first * 10 + values[0]; }
function double(key, value) { return typeof value === "number" ? value * 2 : value; }
function revive(text, reviver) { return JSON.parse(text, reviver); }
function parse(text, depth) { return depth ? parse(text, depth - 1) : JSON.parse(text); }
class Box { constructor() { this.count = 1; } }
function bump(box, depth) { if (depth) bump(box, depth - 1); else box.count = box.count + 1; }
function count(box) { const before = box.count; bump(box, 2); return before * 100 + box.count; }
let sum = 0;
for (let turn = 0; turn < 4; turn++) sum += read(turn & 1 ? watched : bare);
report(sum);
for (let turn = 0; turn < 4; turn++) sum += put(list, list.length, turn);
report(sum);
const three = [1, 2, 3];
for (let turn = 0; turn < 3; turn++) sum += flip(three);
report(sum);
report(revive("[1,2,3]", double).join());
report(parse('{"size":[1,2,3]}', 3).size.length);
const texts = ["1", "{"];
for (let turn = 0; turn < 2; turn++) {
  try { sum += parse(texts[turn], 3); } catch (error) { sum += 100; }
}
report(sum);
const box = new Box();
for (let turn = 0; turn < 2; turn++) sum += count(box);
report(sum);
report("end");
