let kept;
class Shelf { static get late() { kept = this; return "above"; } }
class Peg { constructor(v) { this.v = v; } }
class Rack extends Shelf { static peg = new Peg(1); static early = Rack.late; static late = 2; static read() { return Rack.peg.v; } }
kept.peg.v = "text";
console.log(Rack.early, Rack.late, typeof Rack.read());
