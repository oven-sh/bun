let kept;
class Shelf { static set late(v) { kept = v; } }
class Peg { constructor(v) { this.v = v; } }
class Rack extends Shelf { static peg = new Peg(1); static { Rack.late = Rack.peg; } static late = 2; static read() { return Rack.peg.v; } }
kept.v = "text";
console.log(Rack.late, typeof Rack.read());
