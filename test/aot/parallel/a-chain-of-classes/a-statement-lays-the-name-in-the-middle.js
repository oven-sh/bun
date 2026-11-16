// The climb above the members of a family passes each class once for a question. Here it finds something: the name lies on the prototype of the sixth of twelve.
class C0 { m0() { return 0; } }
class C1 extends C0 { m1() { return 1; } }
class C2 extends C1 { m2() { return 2; } }
class C3 extends C2 { m3() { return 3; } }
class C4 extends C3 { m4() { return 4; } }
class C5 extends C4 { m5() { return 5; } }
class C6 extends C5 { m6() { return 6; } }
class C7 extends C6 { m7() { return 7; } }
class C8 extends C7 { m8() { return 8; } }
class C9 extends C8 { m9() { return 9; } }
class C10 extends C9 { m10() { return 10; } }
class C11 extends C10 { m11() { return 11; } }
C6.prototype.extra = "laid";
function ask(it) { return it.extra; }
const said = [];
for (const it of [new C1(), new C5(), new C6(), new C7(), new C11()]) said.push(String(ask(it)));
console.log(said.join());
