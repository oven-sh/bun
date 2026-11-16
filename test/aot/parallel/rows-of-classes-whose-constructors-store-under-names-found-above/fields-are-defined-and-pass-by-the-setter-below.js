const heard = [];
class Kettle { lid = 1; constructor() { this.base = "iron"; } }
class Samovar extends Kettle { set lid(value) { heard.push("lid " + value); } set base(value) { heard.push("base " + value); } tap = 2; }
class Urn extends Samovar { spout = 3; }
function show(pot) { return JSON.stringify([Object.keys(pot), pot.lid, pot.base, pot.tap, pot.spout]); }
for (const Pot of [Kettle, Samovar, Urn]) console.log(Pot.name, show(new Pot()));
console.log(heard.join(" | "));
