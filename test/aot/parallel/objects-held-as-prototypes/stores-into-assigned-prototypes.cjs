// An object that a function holds as its prototype is a prototype once something is constructed below it. Until then stores into its fields are cached like those of any object.
// COUNTER: operationAOTPutByIdSloppy <= 100
// COUNTER: operationAOTPutById <= 100
const create = Object.create;
const Base = { extend(fields) { const below = create(this); if (fields) below.mixIn(fields); below.init = function () { return below; }; below.init.prototype = below; below.above = this; return below; }, mixIn(fields) { for (const name in fields) this[name] = fields[name]; } };
const words = []; for (let i = 0; i < 16; i++) { const word = Base.extend(); word.high = i; word.low = i * 7; words[i] = word; }
let sum = 0;
for (let turn = 0; turn < 400; turn++) { for (let i = 0; i < 16; i++) { const word = words[i]; word.high = (word.low + turn) | 0; word.low = (word.high ^ i) | 0; } sum = (sum * 31 + words[turn & 15].low) | 0; }
console.log(sum, Object.keys(words[3]).join());

function getHigh(o) { return o.high; } function setHigh(o, v) { o.high = v; } function hasLow(o) { return "low" in o; }
const below = []; for (let i = 0; i < 16; i++) below[i] = new words[i].init();
const own = words.map(word => create(word)); const later = words.map(word => Object.setPrototypeOf({ own: 1 }, word));
class Below extends words[5].init { constructor() { super(); this.own = 2; } }
const said = [];
for (let turn = 0; turn < 6; turn++) {
  let seen = 0; for (let i = 0; i < 16; i++) seen += getHigh(own[i]) - getHigh(later[i]) + getHigh(below[i]) + hasLow(own[i]);
  said.push(seen, own[2] instanceof words[2].init, own[2] instanceof words[3].init, getHigh(new Below()));
  if (turn === 1) for (let i = 0; i < 16; i++) setHigh(words[i], i + 0.5);
  if (turn === 2) { Object.defineProperty(words[4], "high", { get() { return 1000; }, set(v) { said.push("set " + v); }, configurable: true }); setHigh(own[4], 3); setHigh(words[4], 4); }
  if (turn === 3) { delete words[5].high; words[6].low = undefined; delete words[7].low; Object.freeze(words[8]); setHigh(words[8], "refused"); setHigh(own[8], "refused"); }
  if (turn === 4) { Object.setPrototypeOf(words[5], { high: 77 }); setHigh(own[9], "own"); words[9].init.prototype = words[10]; said.push(own[9] instanceof words[9].init, new words[9].init().low === words[9].low); }
}
console.log(said.join(" "));
