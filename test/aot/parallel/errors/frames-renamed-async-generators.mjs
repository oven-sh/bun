// Stack frames of renamed async functions and generators.
const top = (s, n = 2) =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, n)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
const rename = (f, n) => Object.defineProperty(f, "name", { value: n });
const asyncOf = n =>
  rename(async function () {
    return new Error("x").stack;
  }, n);
const asyncLate = n =>
  rename(async function () {
    await 1;
    return new Error("x").stack;
  }, n);
const asyncArrow = n =>
  rename(async () => {
    await 1;
    return new Error("x").stack;
  }, n);
const gen = n =>
  rename(function* () {
    yield new Error("x").stack;
    yield new Error("y").stack;
  }, n);
const asyncGen = n =>
  rename(async function* () {
    yield new Error("x").stack;
    await 1;
    yield new Error("y").stack;
  }, n);
for (const make of [asyncOf, asyncLate, asyncArrow]) {
  const a = make("a1"),
    b = make("b1");
  console.log(top(await a()), "/", top(await b()), "/", top(await a()));
}
{
  const a = gen("g1")(),
    b = gen("g2")();
  console.log("generator", top(a.next().value), "/", top(b.next().value), "/", top(a.next().value));
}
{
  const a = asyncGen("ag1")(),
    b = asyncGen("ag2")();
  console.log(
    "async generator",
    top((await a.next()).value),
    "/",
    top((await b.next()).value),
    "/",
    top((await a.next()).value),
  );
}
{
  const leaf = rename(async function () {
    await 1;
    return new Error("x").stack;
  }, "leaf1");
  const mid = n =>
    rename(async function () {
      return await leaf();
    }, n);
  console.log("awaited by", top(await mid("mid1")(), 4), "/", top(await mid("mid2")(), 4));
}
const key = "k" + 1;
const o = {
  async [key]() {
    await 1;
    return new Error("x").stack;
  },
  *["g" + key]() {
    yield new Error("x").stack;
  },
};
console.log("computed", top(await o[key]()), "/", top(o["g" + key]().next().value));
async function waits() {
  const before = new Error("x").stack;
  await null;
  return top(before) + " / " + top(new Error("x").stack);
}
rename(waits, "renamedWaits");
console.log("a declaration that waits", await waits());
async function shown() {
  const before = new Error("x").stack;
  await null;
  return top(before);
}
shown.displayName = "shownWaits";
console.log("displayName of one that waits", await shown());
async function never() {
  return top(new Error("x").stack);
}
rename(never, "renamedNever");
console.log("a declaration that never waits", await never());
