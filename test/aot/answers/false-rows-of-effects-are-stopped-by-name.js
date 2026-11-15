// answers: without-library
// # testing=CheckEffectsAtRunTime (ir/AOTEffectsNet.h): what the entries of the effects tables say that a call does not do is checked against what the call did.
// # Where the two differ, the process crashes with a named error.
// # Fault injection, testing=UnderstateEffects:<kind>/<row>/<part>: the walk, the sweep and the back end alike read one entry as claiming fewer effects than it does.
// # Each kind of entry and each part is understated once.
// # f2 = bump
// # RUN(NET): run-in-shell testing=CheckEffectsAtRunTime mechanisms=all globalThis.report = value => print(String(value));
// # NET: 491
// # NET-NEXT: end
// # NET-NEXT: exited with 0
// # "Runs no other code": a read by name runs a getter, once with the operation's entry understated and once with the stub's. JSON.parse runs a reviver, with the built-in's entry understated.
// # RUN(OPERATION): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Operation/PropGet/RunsOtherCode mechanisms=all globalThis.report = value => print(String(value));
// # OPERATION: bun: internal AOT error: effects check failed
// # OPERATION-NEXT: the declared effects of operation:PropGet and of stub:GetSizeOfTable say that the call runs no other code, but compiled code was entered
// # OPERATION-NOT: end
// # RUN(STUB): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Stub/GetSizeOfTable/RunsOtherCode mechanisms=all globalThis.report = value => print(String(value));
// # STUB: bun: internal AOT error: effects check failed
// # STUB-NEXT: the declared effects of operation:PropGet and of stub:GetSizeOfTable say that the call runs no other code, but compiled code was entered
// # STUB-NOT: end
// # RUN(REVIVER): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Builtin/JSON.parse/RunsOtherCode mechanisms=all globalThis.report = value => print(String(value));
// # REVIVER: bun: internal AOT error: effects check failed
// # REVIVER-NEXT: the declared effects of operation:CallBuiltin and of built-in:JSON.parse say that the call runs no other code, but compiled code was entered
// # REVIVER-NOT: end
// # "Does not write X": a store past the end of an array, a method that reverses its receiver, and a callee that writes a field of its argument.
// # RUN(STORE): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Stub/PutByValCached/ArrayStorage mechanisms=all globalThis.report = value => print(String(value));
// # STORE: bun: internal AOT error: effects check failed
// # STORE-NEXT: the declared effects of operation:ElemSet and of stub:PutByValCached say that the call does not write ArrayStorage, but operand 0 changed there
// # STORE-NOT: end
// # RUN(METHOD): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Builtin/Array.prototype.reverse/Elements mechanisms=all globalThis.report = value => print(String(value));
// # METHOD: bun: internal AOT error: effects check failed
// # METHOD-NEXT: the declared effects of operation:CallBuiltin and of built-in:Array.prototype.reverse say that the call does not write Elements, but operand 0 changed there
// # METHOD-NOT: end
// # RUN(CALLEE): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Callee/f2/ObjectFields mechanisms=all globalThis.report = value => print(String(value));
// # CALLEE: bun: internal AOT error: effects check failed
// # CALLEE-NEXT: the declared effects of operation:CallDirect and of the callee's effect summary say that the call does not write ObjectFields, but operand 0 changed there
// # CALLEE-NOT: end
// # "Throws nothing": the code that looks for a handler checks whether a call is in progress that is said to throw nothing.
// # RUN(THROWS): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Builtin/JSON.parse/Throws mechanisms=all globalThis.report = value => print(String(value));
// # THROWS: bun: internal AOT error: effects check failed
// # THROWS-NEXT: the declared effects of operation:CallBuiltin and of built-in:JSON.parse say that the call throws no language exception, but it threw one
// # THROWS-NOT: end
// # An entry that says "for lack of memory alone" gets the same check.
// # RUN(BYRULE): run-in-shell testing=CheckEffectsAtRunTime,UnderstateEffects:Builtin/JSON.parse/ThrowsByRule mechanisms=all globalThis.report = value => print(String(value));
// # BYRULE: bun: internal AOT error: effects check failed
// # BYRULE-NEXT: the declared effects of operation:CallBuiltin and of built-in:JSON.parse say that the call throws no language exception, but it threw one
// # BYRULE-NOT: end
// # "Does not collect": the run collects at every allocation that the free lists cannot serve.
// # RUN(COLLECTS): run-in-shell --slowPathAllocsBetweenGCs=1 testing=CheckEffectsAtRunTime,UnderstateEffects:Builtin/JSON.parse/Collects mechanisms=all globalThis.report = value => print(String(value));
// # COLLECTS: bun: internal AOT error: effects check failed
// # COLLECTS-NEXT: the declared effects of operation:CallBuiltin and of built-in:JSON.parse say that the call does not collect, but the heap was collected
// # COLLECTS-NOT: end
// # At the end, the shell runs the same source itself, and every result is the same.
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
