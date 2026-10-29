// RUN: lower
// OPTIONS: builtin-modules

// Outside strict mode one name may be declared several times at the top level: var twice, var and function, function twice, var in a block and outside, var in a loop, var in both arms. The last store counts, and functions come first.
var twice = "first";
var twice = "second";
var varAndFunction = "the var wins once its statement ran";
function varAndFunction() { return "the function"; }
function functionTwice() { return "first"; }
function functionTwice() { return "second"; }
var inBlock = "outside";
{
  var inBlock = "inside the block";
}
for (var inLoop = 0; inLoop < 3; inLoop++) var madeInLoop = "made in a loop " + inLoop;
if (twice) {
  var inArm = "the first arm";
} else {
  var inArm = "the second arm";
}
var neverRead = 1;
var neverRead = 2;
var unusedThenFunction = 1;
function unusedThenFunction() {}
try {
  var inTry = "in try";
} catch (error) {
  var inCatch = "in catch";
}
switch (1) {
  case 1:
    var inSwitch = "in a switch";
}
label: var labeled = "labeled";

console.log(twice, varAndFunction, functionTwice(), inBlock, inLoop, madeInLoop, inArm, inTry, inCatch, inSwitch, labeled);
console.log(typeof globalThis.twice, typeof globalThis.functionTwice, typeof this.twice);

// GENERATED: varAndFunction unusedThenFunction
// CHECK-LABEL: function {{*}}name="varAndFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="the function"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unusedThenFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
