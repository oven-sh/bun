class Shape { get [Symbol.toStringTag]() { return "Shape"; } }
class Round extends Shape { [Symbol.toStringTag] = JSON.parse('"Round"'); }
class R1 extends Round {} class R2 extends Round {} class R3 extends Round {} class R4 extends Round {}
class R5 extends Round {} class R6 extends Round {} class R7 extends Round {} class R8 extends Round {}
const tagOf = round => round[Symbol.toStringTag];
const all = [R1, R2, R3, R4, R5, R6, R7, R8].map(Class => tagOf(new Class()));
console.log(tagOf(new R1()), tagOf(new R4()), tagOf(new R8()), all.join(), tagOf(new Shape()));
class Pair { get [Symbol.toPrimitive]() { return () => 1; } set [Symbol.toPrimitive](value) {} [Symbol.toPrimitive] = () => JSON.parse("2"); }
class P1 extends Pair {} class P2 extends Pair {} class P3 extends Pair {} class P4 extends Pair {} class P5 extends Pair {}
const numberOf = pair => pair[Symbol.toPrimitive]("number");
console.log(numberOf(new P1()), numberOf(new P5()), +new P3());
