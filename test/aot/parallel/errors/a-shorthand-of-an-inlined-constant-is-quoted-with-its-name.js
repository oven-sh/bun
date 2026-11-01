// `bun run` runs what the transpiler prints, which has the value in place of the name of a constant: behind the name where the name is a shorthand.
const o = { f: 1 }, a = 1, yes = true, none = null, text = "t", b = { x: 1 };
let c = 2;
const tries = [
  () => o.nothing({ a }),
  () => o.nothing({ a, c }),
  () => o.nothing({ c, a, yes, none, text }),
  () => o.nothing({ b }),
  () => o.nothing({ a: a }),
  () => o.nothing([{ a }], { inner: { a } }),
  () => new o.nothing({ a }),
  () => ({ a }).nothing.more,
];
for (const attempt of tries) {
  try {
    attempt();
    console.log("nothing thrown");
  } catch (error) {
    console.log(String(error.message));
  }
}
