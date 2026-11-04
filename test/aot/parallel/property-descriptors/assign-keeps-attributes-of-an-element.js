// Object.assign keeps the attributes of an element that the target already has, and throws where the element cannot be written. Plain Bun prints another output.
const parent = { inherited: 1 };
const makers = {
  literal: v => ({ a: v }),
  heir: v => Object.assign(Object.create(parent), { a: v }),
  wide: v => ({ a: v, b: "b", c: v }),
  instance: v =>
    new (class Item {
      constructor(a) {
        this.a = a;
      }
    })(v),
};
const ways = {
  one: (t, s) => Object.assign(t, s),
  behindNothing: (t, s) => Object.assign(t, null, undefined, s),
  itself: t => Object.assign(t, t),
};
const shape = own =>
  String(own.value) + (own.enumerable ? "e" : "-") + (own.configurable ? "c" : "-") + (own.writable ? "w" : "-");
for (const [name, make] of Object.entries(makers))
  for (let bits = 0; bits < 8; bits++) {
    const line = [name, bits];
    for (const assign of Object.values(ways)) {
      const t = make(1);
      const s = make(2);
      s[0] = 3;
      Object.defineProperty(t, "0", {
        value: 5,
        enumerable: (bits & 1) === 0,
        configurable: (bits & 2) === 0,
        writable: (bits & 4) === 0,
      });
      let told = "";
      try {
        assign(t, s);
      } catch (error) {
        told = error.name + " ";
      }
      line.push(told + shape(Object.getOwnPropertyDescriptor(t, "0")));
    }
    console.log(line.join(" | "));
  }
/* Output:
literal | 0 | 3ecw | 3ecw | 5ecw
literal | 1 | 3-cw | 3-cw | 5-cw
literal | 2 | 3e-w | 3e-w | 5e-w
literal | 3 | 3--w | 3--w | 5--w
literal | 4 | TypeError 5ec- | TypeError 5ec- | TypeError 5ec-
literal | 5 | TypeError 5-c- | TypeError 5-c- | 5-c-
literal | 6 | TypeError 5e-- | TypeError 5e-- | TypeError 5e--
literal | 7 | TypeError 5--- | TypeError 5--- | 5---
heir | 0 | 3ecw | 3ecw | 5ecw
heir | 1 | 3-cw | 3-cw | 5-cw
heir | 2 | 3e-w | 3e-w | 5e-w
heir | 3 | 3--w | 3--w | 5--w
heir | 4 | TypeError 5ec- | TypeError 5ec- | TypeError 5ec-
heir | 5 | TypeError 5-c- | TypeError 5-c- | 5-c-
heir | 6 | TypeError 5e-- | TypeError 5e-- | TypeError 5e--
heir | 7 | TypeError 5--- | TypeError 5--- | 5---
wide | 0 | 3ecw | 3ecw | 5ecw
wide | 1 | 3-cw | 3-cw | 5-cw
wide | 2 | 3e-w | 3e-w | 5e-w
wide | 3 | 3--w | 3--w | 5--w
wide | 4 | TypeError 5ec- | TypeError 5ec- | TypeError 5ec-
wide | 5 | TypeError 5-c- | TypeError 5-c- | 5-c-
wide | 6 | TypeError 5e-- | TypeError 5e-- | TypeError 5e--
wide | 7 | TypeError 5--- | TypeError 5--- | 5---
instance | 0 | 3ecw | 3ecw | 5ecw
instance | 1 | 3-cw | 3-cw | 5-cw
instance | 2 | 3e-w | 3e-w | 5e-w
instance | 3 | 3--w | 3--w | 5--w
instance | 4 | TypeError 5ec- | TypeError 5ec- | TypeError 5ec-
instance | 5 | TypeError 5-c- | TypeError 5-c- | 5-c-
instance | 6 | TypeError 5e-- | TypeError 5e-- | TypeError 5e--
instance | 7 | TypeError 5--- | TypeError 5--- | 5---
*/
