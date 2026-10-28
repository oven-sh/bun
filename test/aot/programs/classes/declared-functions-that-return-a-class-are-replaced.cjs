// A declared function that returns a class is stored to, declared twice, or asks which closure runs.
var lines = [];
class Base { who() { return "base"; } }
function Replaced(Parent) { return class extends Parent { who() { return "first>" + super.who(); } }; }
var R1 = Replaced(Base), R2 = Replaced(Base);
Replaced = function (Parent) { return class extends Parent { who() { return "second>" + super.who(); } }; };
var R3 = Replaced(Base), R4 = Replaced(R1);
lines.push([new R1().who(), new R2().who(), new R3().who(), new R4().who()].join());
function Doubled(Parent) { return class extends Parent { who() { return "one"; } }; }
var D1 = Doubled(Base), D2 = Doubled(Base);
function Doubled(Parent) { return class extends Parent { who() { return "two"; } }; }
lines.push([new D1().who(), new D2().who()].join());
function Asks(Parent) { var me = arguments.callee; return class extends Parent { static me = me; }; }
var A1 = Asks(Base), A2 = Asks(Base);
lines.push([A1.me === Asks, A2.me === Asks, A1.me === A2.me].join());
function Caller(Parent) { return class extends Parent { static by = Caller.caller === null ? "null" : typeof Caller.caller; }; }
var C1 = Caller(Base), C2 = Caller(Base); lines.push([C1.by === C2.by].join());
function ThisOne(Parent) { var self = this; return class extends Parent { static self = self; }; }
var T1 = ThisOne(Base), T2 = ThisOne.call(7, Base), T3 = ThisOne(Base); lines.push([T1.self === globalThis, typeof T2.self, T3.self === T1.self].join());
if (lines.length) { function InBlock(Parent) { return class extends Parent { who() { return "block"; } }; } var B1 = InBlock(Base), B2 = InBlock(Base); lines.push([new B1().who(), B1 === B2].join()); }
globalThis.Leaked = Replaced; lines.push(new (Leaked(Base))().who());
console.log(lines.join("\n"));
