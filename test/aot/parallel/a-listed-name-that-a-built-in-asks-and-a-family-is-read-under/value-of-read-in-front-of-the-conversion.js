// Under: --aot-testing=DelayFlowRules: every pass of Link on the lanes, its worklist scattered: what a read through a family is tied to may not hang on whether the built-in asked the name first.
// Under: --aot-testing=DelayOtherFlowRules: the oldest first.
class Base { constructor(n) { this.n = n; this.valueOf = n & 1 ? function odd() { return this.n + 100; } : function even() { return this.n + 200; }; } }
class Left extends Base { left() { return 1; } }
class Right extends Base { right() { return 2; } }
const all = [new Base(0), new Left(1), new Right(2), new Left(3)];
function pick(i) { return all[i % all.length]; }
let sum = 0;
for (let i = 0; i < 6; i++) sum += pick(i).valueOf.call(pick(i));
for (let i = 0; i < 6; i++) sum += pick(i) * 2 + (pick(i) > 150 ? 1 : 0);
console.log(sum);
