// An object that a function holds as its prototype is a prototype once something is constructed below it. Until then stores into its fields are cached like those of any object.
// COUNTER: operationAOTPutByIdSloppy <= 100
// COUNTER: operationAOTPutById <= 100
const create = Object.create;
const Bead = { strung(red) { const first = function () { return made; }, made = create(this, { first: { value: first, writable: true, configurable: true, enumerable: true } }); if (red !== undefined) made.red = red; first.prototype = made; return made; } };
const beads = []; for (let i = 0; i < 16; i++) { const bead = Bead.strung(); bead.red = i; bead.blue = i * 7; beads[i] = bead; }
let sum = 0;
for (let turn = 0; turn < 400; turn++) { for (let i = 0; i < 16; i++) { const bead = beads[i]; bead.red = (bead.blue + turn) | 0; bead.blue = (bead.red ^ i) | 0; } sum = (sum * 31 + beads[turn & 15].blue) | 0; }
console.log(sum, Object.keys(beads[3]).join());

function getRed(o) { return o.red; } function setRed(o, v) { o.red = v; } function hasBlue(o) { return "blue" in o; }
const below = []; for (let i = 0; i < 16; i++) below[i] = new beads[i].first();
const own = beads.map(bead => create(bead)); const later = beads.map(bead => Object.setPrototypeOf({ own: 1 }, bead));
class Below extends beads[5].first { constructor() { super(); this.own = 2; } }
const said = [];
for (let turn = 0; turn < 6; turn++) {
  let seen = 0; for (let i = 0; i < 16; i++) seen += getRed(own[i]) - getRed(later[i]) + getRed(below[i]) + hasBlue(own[i]);
  said.push(seen, own[2] instanceof beads[2].first, own[2] instanceof beads[3].first, getRed(new Below()));
  if (turn === 1) for (let i = 0; i < 16; i++) setRed(beads[i], i + 0.5);
  if (turn === 2) { Object.defineProperty(beads[4], "red", { get() { return 1000; }, set(v) { said.push("set " + v); }, configurable: true }); setRed(own[4], 3); setRed(beads[4], 4); }
  if (turn === 3) { delete beads[5].red; beads[6].blue = undefined; delete beads[7].blue; Object.freeze(beads[8]); setRed(beads[8], "refused"); setRed(own[8], "refused"); }
  if (turn === 4) { Object.setPrototypeOf(beads[5], { red: 77 }); setRed(own[9], "own"); beads[9].first.prototype = beads[10]; said.push(own[9] instanceof beads[9].first, new beads[9].first().blue === beads[9].blue); }
}
console.log(said.join(" "));
