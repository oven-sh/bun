// A method of a base class hands back `this`, objects of two classes below it call the method, and each goes on with a member that only its own class has.
// Under: --aot-testing=CheckProofsAtRunTime: the result of a call whose callee returns `this`
class Chain { self() { return this; } }
class First extends Chain { one() { return "one"; } }
class Second extends Chain { two() { return "two"; } }
function first(o) { return o.self().one(); }
function second(o) { return o.self().two(); }
function borrowed(o) { const self = Chain.prototype.self; return self.call(o) === o; }
function looped() { let s = ""; for (let i = 0; i < 3; i++) s += first(new First()) + second(new Second()) + ","; return s; }
console.log(first(new First()), second(new Second()), borrowed(new First()), borrowed(new Second()), looped());
