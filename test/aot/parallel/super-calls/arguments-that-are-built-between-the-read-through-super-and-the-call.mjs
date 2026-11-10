// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: SuperMethodLookupsGuarded >= 2
// STATISTIC: SuperCallsDevirtualized >= 3
const words = JSON.parse('{"proto":"prototype","price":"price"}');
const log = [];
let deed = () => {};
class Ware { constructor(worth) { this.worth = worth; } price(options) { return this.worth * options.rate + options.more.length; } }
class Boxed extends Ware { price(options) { return super.price({ rate: options.rate * 2, more: [deed("boxed"), ...options.more] }) + 1; } }
class Sealed extends Boxed { price(options) { return super.price({ ...options, rate: options.rate + (deed("sealed"), 0.5) }) * 2; } }
class Looped extends Ware { price(options) { let all = 0; for (const more of options.more) all += super.price({ rate: more, more: [deed("looped")] }); return all; } }
class Other { price(options) { return -options.rate; } }
const things = [new Boxed(JSON.parse("2")), new Sealed(3), new Looped(4)];
const tell = word => {
  let said;
  try { said = things.map(thing => thing.price({ rate: 1.5, more: [1, 2] })).join(" "); } catch (e) { said = e.name; }
  console.log(word, said, log.splice(0).join(","));
};
tell("as written");
tell("again");
deed = who => { log.push(who); };
tell("the arguments say that they ran");
deed = who => { if (who === "sealed") throw new RangeError(who); };
tell("an argument throws");
let once = true;
deed = who => { if (once && who === "boxed") { once = false; Ware[words.proto][words.price] = () => 1000; } };
tell("an argument stores over the method: the old one is called this once");
tell("and the new one from then on");
once = true;
deed = who => { if (once && who === "sealed") { once = false; Object.setPrototypeOf(Sealed[words.proto], Other[words.proto]); } };
tell("an argument changes the link: the old method is called this once");
tell("and what stands above now from then on");
Object.setPrototypeOf(Boxed[words.proto], { get [words.price]() { log.push(this === things[0] ? "the receiver" : "another"); return () => 7; } });
deed = who => { log.push(who); };
tell("a getter above is read in front of the arguments");
