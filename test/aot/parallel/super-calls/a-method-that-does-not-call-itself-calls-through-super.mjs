// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: CallsThroughSuperMadeBehindGuards >= 2
const words = JSON.parse('{"proto":"prototype","price":"price"}');
class Ware { constructor(worth) { this.worth = worth; } price(rate) { return this.worth * rate; } get tag() { return "ware"; } }
class Boxed extends Ware { price(rate) { return super.price(rate) + 1; } name() { return super.tag + "!"; } }
class Sealed extends Boxed { price(rate, more) { return super.price(rate, more) * 2; } }
const things = JSON.parse("[1,2,3]").map((worth, place) => place % 2 ? new Sealed(worth) : new Boxed(worth));
const tell = word => console.log(word, things.map(thing => thing.price(1.5) + thing.name()).join(" "));
tell("as written");
Object.defineProperty(Ware[words.proto], words.price, { get() { return function (rate) { return "got" + rate + this.worth; }; }, configurable: true });
tell("a getter above");
delete Ware[words.proto][words.price];
try { tell("nothing above"); } catch (e) { console.log("nothing above", e.name); }
Object.setPrototypeOf(Boxed[words.proto], null);
try { tell("no class above"); } catch (e) { console.log("no class above", e.name); }
