// RUN: lower
// OPTIONS: builtin-modules

// Built ins found by binding: programs late members. It prints what plain Bun prints.
function readFlag() {
  return process.noDeprecation;
}
function readAll() {
  return [process.noDeprecation, process.traceDeprecation, process.throwDeprecation, process.pendingDeprecation, process.traceProcessWarnings, process.noProcessWarnings].join();
}
console.log(readAll(), "noDeprecation" in process, Object.hasOwn(process, "noDeprecation"));
process.noDeprecation = true;
console.log(readFlag(), "noDeprecation" in process);
console.log("x" in process, process.x);
process.x = { y: 1 };
console.log("x" in process, process.x.y, Object.keys(process).includes("x"));
console.log(process._events, process._eventsCount, process._maxListeners, "_events" in process);
const EventEmitter = require("node:events");
console.log(process._events, process._eventsCount, process._maxListeners, "_events" in process);
EventEmitter.prototype.added = function () {
  return "added " + (this === process);
};
console.log(process.added());
Object.getPrototypeOf(process).alsoAdded = 3;
console.log(process.alsoAdded + 1);
console.log(typeof process._debugEnd, typeof process._debugProcess, typeof process._startProfilerIdleNotifier, typeof process._stopProfilerIdleNotifier);
const key = ["no", "Deprecation"].join("");
console.log(process[key], delete process.noDeprecation, process[key], readFlag());
function lengthOfStored() {
  return process.throwDeprecation.length;
}
process.throwDeprecation = "text";
console.log(lengthOfStored(), typeof process.throwDeprecation);

// GENERATED: readFlag readAll
// CHECK-LABEL: function {{*}}name="readFlag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="noDeprecation"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readAll"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="noDeprecation"
// CHECK-NEXT: v2 = Builtin builtin=Process
// CHECK-NEXT: v3 = PropGet v2 key="traceDeprecation"
// CHECK-NEXT: v4 = Builtin builtin=Process
// CHECK-NEXT: v5 = PropGet v4 key="throwDeprecation"
// CHECK-NEXT: v6 = Builtin builtin=Process
// CHECK-NEXT: v7 = PropGet v6 key="pendingDeprecation"
// CHECK-NEXT: v8 = Builtin builtin=Process
// CHECK-NEXT: v9 = PropGet v8 key="traceProcessWarnings"
// CHECK-NEXT: v10 = Builtin builtin=Process
// CHECK-NEXT: v11 = PropGet v10 key="noProcessWarnings"
// CHECK-NEXT: v12 = NewArray v1, v3, v5, v7, v9, v11 contents=anything
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13 calleeKey="join" calleeName="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
