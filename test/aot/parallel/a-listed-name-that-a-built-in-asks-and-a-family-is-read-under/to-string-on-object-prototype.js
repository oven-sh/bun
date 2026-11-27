// Under: --aot-testing=DelayFlowRules: every pass of Link on the lanes, its worklist scattered: what a read through a family is tied to may not hang on whether the built-in asked the name first.
// Under: --aot-testing=DelayOtherFlowRules: the oldest first.
class Base { constructor(n) { this.n = n; this.toString = n & 1 ? function odd() { return "odd" + this.n; } : function even() { return "even" + this.n; }; } }
class Left extends Base { left() { return 1; } }
class Right extends Base { right() { return 2; } }
class Far extends Right { far() { return 3; } }
const all = [new Base(0), new Left(1), new Right(2), new Far(3), new Left(4)];
function pick(i) { return all[i % all.length]; }
let said = "";
for (let i = 0; i < 7; i++) said += String(pick(i)) + "," + typeof pick(i).toString + ";";
console.log(said);
console.log(`${pick(1)}|${pick(2)}`, [pick(3)].join());
