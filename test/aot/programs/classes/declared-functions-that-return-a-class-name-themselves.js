// A declared function that returns a class names itself: in its body, in the class, as a value, with members of its own.
const lines = [];
class Base { who() { return "base"; } }
class Other { who() { return "other"; } }
lines.push(new (Early(Base))().who());
function Early(Parent) { return class extends Parent { who() { return "early>" + super.who(); } }; }
function Self(Parent) { Self.calls = (Self.calls ?? 0) + 1; return class extends Parent { static maker = Self; static again(P) { return Self(P); } made() { return Self.calls; } same(f) { return f === Self; } }; }
const S1 = Self(Base), S2 = Self(Other);
lines.push([S1.maker === Self, S2.maker === Self, S1.maker === S2.maker, Self.calls, new S1().made(), new S2().same(Self), new S1().same(S1.maker), Self.name, Self.length, typeof Self.prototype].join());
const S3 = S1.again(Base), S4 = S2.again(S3);
lines.push([Self.calls, S3 === S1, new S4() instanceof S3, new S4() instanceof S1, new S4().who(), S4.maker === Self].join());
function Twice(Parent, depth) { return class extends (depth ? Twice(Parent, depth - 1) : Parent) { level() { return depth + (super.level ? super.level() : 0); } }; }
const T1 = Twice(Base, 2), T2 = Twice(Other, 1);
lines.push([new T1().level(), new T2().level(), new T1().who(), new T2().who()].join());
function Kept(Parent) { return class extends Parent { static from = Kept; }; }
const held = [Kept, Kept]; const K1 = Kept(Base), K2 = held[0](Base), K3 = held[1].call(null, Other), K4 = Kept(Other);
lines.push([K1.from === Kept, K2.from === K1.from, K3.from === held[0], K1 === K2, new K4().who(), Kept.toString().length === held[1].toString().length].join());
Kept.extra = 5; lines.push([K1.from.extra, K4.from.extra, Object.keys(Kept).join()].join());
console.log(lines.join("\n"));
