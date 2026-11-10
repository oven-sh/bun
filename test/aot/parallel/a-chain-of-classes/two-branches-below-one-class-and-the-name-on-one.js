// Two classes stand below one class of a chain and the name lies above the objects of one of them alone: a class that one member has climbed answers for that way up, not for the branch beside it.
class C0 { m0() { return 0; } }
class C1 extends C0 { m1() { return 1; } }
class C2 extends C1 { m2() { return 2; } }
class C3 extends C2 { m3() { return 3; } }
class C4 extends C3 { m4() { return 4; } }
class C5 extends C4 { m5() { return 5; } }
class C6 extends C5 { m6() { return 6; } }
class C7 extends C6 { m7() { return 7; } }
class Left extends C5 {}
class Right extends C5 {}
Left.prototype.extra = "left";
function ask(it) { return it.extra; }
const said = [];
for (const it of [new C5(), new Left(), new Right(), new C6(), new C7()]) said.push(String(ask(it)));
console.log(said.join());
