// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: CallsThroughSuperMadeBehindGuards >= 3
const words = JSON.parse('{"price":"price","label":"label","proto":"prototype"}');
class Ware { constructor(worth) { this.worth = worth; } price(rate) { return this.worth * rate; } label() { return "ware " + this.worth; } }
class Boxed extends Ware { price(rate, again) { return again ? this.price(rate) : super.price(rate) + 1; } label(again) { return again ? this.label() : "boxed " + super.label(); } }
class Sealed extends Boxed { price(rate, again) { return again ? this.price(rate) : super.price(rate) * 2; } }
class Other { price(rate) { return -rate; } label() { return "other"; } }
const things = JSON.parse("[1,2,3]").map((worth, place) => place % 2 ? new Sealed(worth) : new Boxed(worth));
const tell = word => console.log(word, things.map(thing => thing.price(1.5) + "/" + thing.label()).join(" "));
tell("as written");
tell("again");
console.log("borrowed", Boxed[words.proto][words.price].call({ worth: 10 }, 2), Sealed[words.proto][words.price].call({ worth: 10 }, 2));
Ware[words.proto][words.price] = function (rate) { return 100 + rate; };
tell("the method above replaced");
delete Ware[words.proto][words.label];
try { tell("the method above deleted"); } catch (e) { console.log("the method above deleted", e.name); }
Object.defineProperty(Ware[words.proto], words.label, { get() { return () => "got"; }, configurable: true });
tell("a getter above");
Object.setPrototypeOf(Boxed[words.proto], Other[words.proto]);
tell("the link of the class changed");
Object.setPrototypeOf(Sealed[words.proto], Ware[words.proto]);
tell("the link of the heir changed");
Object.setPrototypeOf(Boxed[words.proto], null);
try { tell("no class above"); } catch (e) { console.log("no class above", e.name); }
