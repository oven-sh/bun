// answers: without-library
// # function bump() { box.count = 2; } takes nothing and writes a field of an object that everybody sees. function outer() { bump(); } calls it directly and does nothing else.
// # Link's effects of f4 are taken to name no write that anybody sees, as the verifier of a unit reads them: the call stops it. A call without operands passed for an operation that fills what the unit itself makes.
// # OPTIONS: check=Validate testing=UnderstateEffects:Summary/f4/WhatIsSeen
// # DIAGNOSTIC: EffectsNotCounted
// # RUN: walk f4 mechanisms=all-Inlining
// # CHECK-NOT: code f4:Body
// # f3 = bump, f4 = outer
class Box { constructor() { this.count = 1; } }
const box = new Box();
function main() { function bump() { box.count = 2; } function outer() { bump(); } outer(); outer(); }
main();
report(box.count);
report("end");
