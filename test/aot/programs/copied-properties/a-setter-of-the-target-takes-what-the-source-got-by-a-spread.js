// Object.assign stores into its target, so a setter there takes each value of the source. The source is a literal with a name of its own and a spread: the setter takes what the spread has brought.
const more = { b: "other" };
Object.assign(
  {
    set b(x) {
      console.log("b", typeof x, x);
    },
  },
  { a: 1, ...more },
);
