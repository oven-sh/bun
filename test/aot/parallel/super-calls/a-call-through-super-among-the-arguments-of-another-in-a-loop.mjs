// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: CallsThroughSuperMadeBehindGuards >= 3
const words = JSON.parse('{"n":40,"proto":"prototype","price":"price"}');
class Ware { constructor(worth) { this.worth = worth; } price(rate) { return this.worth * rate; } tag(n) { return n + this.worth; } }
class Boxed extends Ware { price(rate) { let all = 0; for (let i = 0; i < rate; i++) all += super.price(super.tag(i)) + super.tag(1); return all; } }
const thing = new Boxed(words.n);
console.log("as written", thing.price(3), thing.price(5));
Ware[words.proto][words.price] = () => 6;
console.log("another method is stored over the outer one", thing.price(3));
Object.setPrototypeOf(Boxed[words.proto], { [words.price]() { return 5; }, tag() { return 1; } });
console.log("another object stands above the home", thing.price(3));
