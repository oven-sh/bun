class Anchor { weigh() { return 1; } }
class Barrel { weigh() { return 2; } }
class Candle { weigh() { return 3; } }
class Dagger { weigh() { return 4; } }
class Ember { weigh() { return 5; } }
class Fiddle { weigh() { return 6; } }
class Goblet { weigh() { return 7; } }
class Hammer { weigh() { return 8; } }
class Icicle { weigh() { return 9; } }
class Jacket { weigh() { return 10; } }
class Kettle { weigh() { return 11; } }
class Ladder { weigh() { return 12; } }
class Mallet { weigh() { return 13; } }
class Needle { weigh() { return 14; } }
const all = [new Anchor(), new Barrel(), new Candle(), new Dagger(), new Ember(), new Fiddle(), new Goblet(), new Hammer(), new Icicle(), new Jacket(), new Kettle(), new Ladder(), new Mallet(), new Needle()];
let sum = 0;
for (const each of all) sum += each.weigh();
const pick = (at) => at == 0 ? new Anchor() : at == 1 ? new Barrel() : at == 2 ? new Candle() : at == 3 ? new Dagger() : at == 4 ? new Ember() : at == 5 ? new Fiddle() : at == 6 ? new Goblet() : at == 7 ? new Hammer() : at == 8 ? new Icicle() : at == 9 ? new Jacket() : at == 10 ? new Kettle() : at == 11 ? new Ladder() : at == 12 ? new Mallet() : new Needle();
for (let at = 0; at < 16; at++) sum += pick(at).weigh();
console.log(sum);
