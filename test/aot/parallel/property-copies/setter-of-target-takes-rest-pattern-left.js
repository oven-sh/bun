// A rest pattern makes a copy of what it leaves. Object.assign hands that to a setter that the target inherits.
const { dropped, ...rest } = { dropped: 0, b: { k: "deep" } };
Object.assign(
  Object.create({
    set b(x) {
      console.log("b", typeof x, x.k);
    },
  }),
  rest,
);
