// `bun run` prints `{ a: a }` as `{ a }`, and an error quotes what is printed.
void 0;
const o = { f: 1 };
let a = 1, c = 2;
const tries = [
  () => o.nothing({a:a}),
  () => o.nothing({ a: a }),
  () => o.nothing({ "a": a }),
  () => o.nothing({ 'a': a }),
  () => o.nothing({ a: (a) }),
  () => o.nothing({ a:   a , c }),
  () => o.nothing({ a: a, c: c }),
  () => o.nothing(({ a: a }) => a),
  () => o.nothing(function ({ a: a }) {}),
  () => o.nothing(({ a: a = 1 }) => a),
  () => o.nothing({ a: a.b }),
  () => o.nothing({ a: c }),
  () => o.nothing({ [a]: a }),
  () => o.nothing({ o: o }),
  () => o.nothing({ a: /* note */ a }),
  () => o.nothing({ a /* note */: a }),
  () => o.nothing({ undefined: undefined, NaN: NaN }),
  () => o.nothing({ arguments: 1, eval: eval }),
  () => { const { a: a } = o; o.nothing(a); },
  () => o.nothing([{ a: a }], { inner: { a: a } }),
  () => new o.nothing({ a: a }),
  () => o.nothing`${{ a: a }}`,
  () => ({ a: a }).nothing(),
  () => { let await_ = 1; o.nothing({ await_: await_ }); },
  function () { o.nothing({ arguments: arguments }); },
  () => o.nothing({ __proto__: __proto__ }),
];
var __proto__ = null;
for (const attempt of tries) {
  try {
    attempt();
    console.log("returned");
  } catch (error) {
    console.log(error.message);
  }
}
