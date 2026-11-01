// `super.width` where the prototype of the home object is null: the message quotes the expression, which is `super.` and the name of the member.
const home = {
  __proto__: null,
  read() { return super.width; },
  readTwice() { return [super.height, super.height]; },
  readInTry() { try { return super.depth; } catch (error) { return "caught " + error.message; } },
};
class Base {}
class Derived extends Base {
  static read() { return super.length; }
}
Object.setPrototypeOf(Derived, null);
for (let round = 0; round < 3; round++) {
  for (const run of [() => home.read(), () => home.readTwice(), () => home.readInTry(), () => Derived.read()]) {
    try {
      console.log(String(run()));
    } catch (error) {
      console.log(error.constructor.name + ": " + error.message);
    }
  }
}
