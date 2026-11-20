// The getter stands in the base and an heir defines a field over it; eight classes extend the heir.
class Shape { get [Symbol.toStringTag]() { return "Shape"; } }
class Round extends Shape { [Symbol.toStringTag] = JSON.parse('"Round"'); }
class R1 extends Round {} class R2 extends Round {} class R3 extends Round {} class R4 extends Round {}
class R5 extends Round {} class R6 extends Round {} class R7 extends Round {} class R8 extends Round {}
const t = r => r[Symbol.toStringTag];
const all = [R1, R2, R3, R4, R5, R6, R7, R8].map(K => t(new K()));
console.log(t(new R1()), t(new R4()), t(new R8()), all.join());
