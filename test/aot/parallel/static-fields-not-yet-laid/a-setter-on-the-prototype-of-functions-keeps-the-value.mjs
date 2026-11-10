let kept;
Object.defineProperty(Function.prototype, "late", { configurable: true, set(v) { kept = v; } });
class Peg { constructor(v) { this.v = v; } }
class Rack { static peg = new Peg(1); static { Rack.late = Rack.peg; } static late = 2; static read() { return Rack.peg.v; } }
kept.v = "text";
console.log(Rack.late, typeof Rack.read());
