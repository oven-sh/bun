let seen = "";
let held = null;
class Barrel { weigh() { return 1; } }
class Candle { weigh() { return 2; } }
class Dagger { weigh() { return 3; } }
class Ember { weigh() { return 4; } }
class Fiddle { weigh() { return 5; } }
class Goblet { weigh() { return 6; } }
class Hammer { weigh() { return 7; } }
class Icicle { weigh() { return 8; } }
class Jacket { weigh() { return 9; } }
class Anchor { [key: string]: any; }
if ((seen.length & 0) == 0) held = new Barrel();
seen += held!.weigh() + " ";
if ((seen.length & 1) == 0) held = new Candle();
seen += held!.weigh() + " ";
if ((seen.length & 2) == 0) held = new Dagger();
seen += held!.weigh() + " ";
if ((seen.length & 3) == 0) held = new Ember();
seen += held!.weigh() + " ";
if ((seen.length & 0) == 0) held = new Fiddle();
seen += held!.weigh() + " ";
if ((seen.length & 1) == 0) held = new Goblet();
seen += held!.weigh() + " ";
if ((seen.length & 2) == 0) held = new Hammer();
seen += held!.weigh() + " ";
if ((seen.length & 3) == 0) held = new Icicle();
seen += held!.weigh() + " ";
if ((seen.length & 0) == 0) held = new Jacket();
seen += held!.weigh() + " ";
if (seen.length > 3) { const made = new Anchor(); made.weigh = () => "text"; held = made; }
const answer = held!.weigh();
seen += typeof answer + ":" + answer;
console.log(seen);
