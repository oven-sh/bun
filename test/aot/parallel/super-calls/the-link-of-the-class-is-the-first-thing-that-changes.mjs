// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: CallsThroughSuperMadeBehindGuards >= 2
const words = JSON.parse('{"proto":"prototype"}');
class Ware { constructor(worth) { this.worth = worth; } price(rate) { return this.worth * rate; } }
class Boxed extends Ware { price(rate, again) { return again ? this.price(rate) : super.price(rate) + 1; } }
class Sealed extends Boxed { price(rate, again) { return again ? this.price(rate) : super.price(rate) * 2; } }
class Other { price(rate) { return -rate; } }
const things = JSON.parse("[1,2,3]").map((worth, place) => place % 2 ? new Sealed(worth) : new Boxed(worth));
const tell = word => console.log(word, things.map(thing => thing.price(1.5)).join(" "));
tell("as written");
tell("again");
Object.setPrototypeOf(Boxed[words.proto], Other[words.proto]);
tell("the link of the class changed");
Object.setPrototypeOf(Sealed[words.proto], Ware[words.proto]);
tell("the link of the heir changed");
Object.setPrototypeOf(Boxed[words.proto], Ware[words.proto]);
tell("the first link put back");
