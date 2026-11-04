// No type is written: the modifiers alone make the properties.
class Bare { constructor(public one, readonly two = 2, private three?) {} }
class Barer extends Bare { constructor(protected four) { super(four) } }
const AgainBare = (0, eval)("(" + String(Bare) + ")");
const AgainBarer = (0, eval)("(function (Bare) { return (" + String(Barer) + "); })")(AgainBare);
console.log(JSON.stringify(new Bare(1)), JSON.stringify(new AgainBare(1)), Object.keys(new AgainBare(1)).join());
console.log(JSON.stringify(new Barer(4)), JSON.stringify(new AgainBarer(4)), Object.keys(new AgainBarer(4)).join());
