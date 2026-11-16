class Kettle { constructor() { this.lid = 1; } }
class Samovar extends Kettle { constructor(other) { super(); this.tap = 2; if (other) return Object.create(Urn.prototype); } }
class Urn extends Samovar { constructor(other) { super(other); this.spout = 3; } }
function show(pot) { return JSON.stringify([Object.keys(pot), pot.lid, pot.tap, pot.spout, pot instanceof Urn]); }
console.log(show(new Urn(false)), show(new Urn(true)), show(new Samovar(false)), show(new Samovar(true)));
