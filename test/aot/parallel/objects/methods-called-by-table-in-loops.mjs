// Under: --aot-testing=CheckEffectsAtRunTime: the entry of a method that a table calls counted the call of its body as a call of other code
class Kind0 { count = 1; constructor(one = 0) { this.count = one; } size(one) { for (let at = 0; at < 2; at++) this.count += at; return this.count; } run(one) { return one; } }
class Kind1 { count = 2.5; constructor(one = 0) { this.count = one; } size(one) { for (let at = 0; at < 2; at++) this.count += at; return this.count; } run(one) { return one + 1; } }
function plus(one, two) { return typeof one === "number" && typeof two === "number" ? one + two : String(one).length + (two ? 1 : 0); }
function work(all, count) { let total = 0; for (let turn = 0; turn < count; turn++) { const one = all[turn % all.length]; total = plus(total, all[turn % all.length].size(turn)); if (turn === 2) { Kind1.prototype["run"] = one => one; all[1] = { size: () => 900 }; } } return total; }
const o = new Kind0(1);
console.log(work([new Kind1(1)], 1)); Kind0.prototype.run = Kind1.prototype.run; console.log(work([o, o, new Kind0(0)], 12), o.count);
