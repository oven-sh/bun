// Under: --aot-testing=DelayFlowRules: every pass of Link on the lanes, its worklist scattered: what a read through a family is tied to may not hang on whether the built-in asked the name first.
// Under: --aot-testing=DelayOtherFlowRules: the oldest first.
class Base { constructor(n) { this.n = n; this.toJSON = n & 1 ? function odd() { return "odd" + this.n; } : function even() { return { even: this.n }; }; } }
class Left extends Base { left() { return 1; } }
class Right extends Base { right() { return 2; } }
const all = [new Base(0), new Left(1), new Right(2), new Left(3)];
function pick(i) { return all[i % all.length]; }
let said = "";
for (let i = 0; i < 5; i++) said += JSON.stringify(pick(i)) + typeof pick(i).toJSON;
console.log(said, JSON.stringify(all));
