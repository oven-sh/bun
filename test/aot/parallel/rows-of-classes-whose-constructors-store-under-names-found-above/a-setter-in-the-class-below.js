const heard = [];
class Kettle { constructor() { this.lid = 1; this.base = "iron"; } }
class Samovar extends Kettle { set lid(value) { heard.push("setter " + value); } get lid() { return "from the getter"; } }
class Urn extends Samovar { constructor() { super(); this.spout = 2; } }
class Flask extends Urn { constructor() { super(); this.cork = 3; } }
function show(pot) { return JSON.stringify([Object.keys(pot), pot.lid, pot.base, pot.spout, pot.cork]); }
for (const Pot of [Kettle, Samovar, Urn, Flask]) console.log(Pot.name, show(new Pot()));
console.log(heard.join(" | "));
