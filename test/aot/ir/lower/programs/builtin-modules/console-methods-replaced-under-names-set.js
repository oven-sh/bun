// RUN: lower
// OPTIONS: builtin-modules

// Every assignment in compiled code to a member of console works, and a later call runs what was stored. Here the names come out of a Set.
const print = console.log.bind(console);
const calls = [];
const replacementFor = name => (...values) => { calls.push(name + "(" + values.join() + ")"); };
for (const name of new Set(["log", "countReset", "groupEnd", "timeLog", "table", "warn", "assert", "dirxml"])) console[name] = replacementFor(name);
console.log(1); console.countReset(2); console.groupEnd(3); console.timeLog(4); console.table(5); console.warn(6); console.assert(7); console.dirxml(8);
print(calls.join(" "));

// GENERATED: replacementFor
// CHECK-LABEL: function {{*}}name="replacementFor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
