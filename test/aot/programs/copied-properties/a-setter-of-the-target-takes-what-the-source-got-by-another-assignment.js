// The source of the second Object.assign is the target of the first: what it holds was copied onto it. A setter of the second target takes it, and calls it.
const more = { b: () => "called" };
const source = Object.assign({ a: 1 }, more);
Object.assign(
  {
    set b(x) {
      console.log("b", typeof x, x());
    },
  },
  source,
);
