// A method under a constant key that is printed in brackets: the quote has the object and the brackets, as under `bun run`.
const o = { f: 1, inner: { g: 2 } };
const tries = [
  () => o["字"](),
  () => o["é"](1, 2),
  () => o["a\nb"](),
  () => o["a b"](),
  () => o["a-b"](o.f),
  () => o.inner["字"](),
  () => o.inner["字"](o["字"]),
  () => new o["字"](),
  () => new o["a b"](1),
  () => new o.inner["字"](o.f),
  () => o.字(),
  () => o.plain(),
];
for (const attempt of tries) {
  try {
    attempt();
    console.log("nothing thrown");
  } catch (error) {
    console.log(JSON.stringify(String(error.message)));
  }
}
