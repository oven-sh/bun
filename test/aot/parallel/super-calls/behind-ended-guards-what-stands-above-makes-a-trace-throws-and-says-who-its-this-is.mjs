// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: SuperCallsDevirtualized >= 1
const words = JSON.parse('{"proto":"prototype","price":"price"}');
class Ware { constructor(worth) { this.worth = worth; } price(rate) { return this.worth * rate; } }
class Boxed extends Ware { price(rate) { return super.price(rate) + 1; } }
const thing = new Boxed(JSON.parse("4"));
const tell = word => {
  let said;
  try { said = String(thing.price(1.5)); } catch (e) { said = e.name + " " + typeof e.stack + " " + /price/.test(e.stack); }
  console.log(word, said);
};
tell("as written");
tell("again");
tell("a third time");
Object.setPrototypeOf(Boxed[words.proto], {
  get [words.price]() {
    const trace = new Error("seen").stack;
    const whose = this === thing ? "the receiver" : this === Boxed[words.proto] ? "the home" : "another";
    return rate => typeof trace + " " + /price/.test(trace) + " " + whose + " " + rate;
  },
});
tell("a getter above that makes a trace");
tell("again");
Object.setPrototypeOf(Boxed[words.proto], { get [words.price]() { throw new RangeError("from above"); } });
tell("a getter above that throws");
Object.setPrototypeOf(Boxed[words.proto], { [words.price](rate) { throw new SyntaxError("from the method above " + rate); } });
tell("a method above that throws");
Object.setPrototypeOf(Boxed[words.proto], null);
tell("null above");
Object.setPrototypeOf(Boxed[words.proto], new Proxy({}, { get(target, key, receiver) { return () => String(key) + " " + (receiver === thing); } }));
tell("a proxy above");
