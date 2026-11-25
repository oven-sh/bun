class Box {
  #held;
  constructor(held) {
    this.#held = held;
  }
}
const throws = () => ({
  get inner() {
    throw new RangeError("out of the getter");
  },
});
const ask = (name, question) => {
  try {
    console.log(name + ":", question());
  } catch (error) {
    console.log(name + ": threw", error.name, error.message);
  }
};
ask("the pattern throws", () => Bun.deepMatch(new Box(throws()), new Box({ inner: 1 })));
ask("the value throws", () => Bun.deepMatch(new Box({ inner: 1 }), new Box(throws())));
ask("both hold the same", () => Bun.deepMatch(new Box({ inner: 1 }), new Box({ inner: 1 })));
ask("they differ", () => Bun.deepMatch(new Box({ inner: 1 }), new Box({ inner: 2 })));
ask("behind one that differs", () => Bun.deepMatch(new Box({ first: 1, inner: 1 }), new Box({ first: 2, get inner() { throw new RangeError("never asked"); } })));
ask("two levels down", () => Bun.deepMatch(new Box(new Box(throws())), new Box(new Box({ inner: 1 }))));
/* Output:
the pattern throws: threw RangeError out of the getter
the value throws: threw RangeError out of the getter
both hold the same: true
they differ: false
behind one that differs: false
two levels down: threw RangeError out of the getter
*/
