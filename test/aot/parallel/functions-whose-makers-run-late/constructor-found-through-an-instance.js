const hidden = value => { try { throw value; } catch (caught) { return caught; } };
class Kettle { constructor(liters) { this.liters = liters; } twice() { return this.liters * 2; } }
class Pan { constructor(liters) { this.liters = liters + 1; } twice() { return this.liters * 3; } }
const first = hidden(new Kettle(2));
const Again = first.constructor;
console.log(new Again(5).twice(), new (hidden(new Pan(1)).constructor)(1).twice());
