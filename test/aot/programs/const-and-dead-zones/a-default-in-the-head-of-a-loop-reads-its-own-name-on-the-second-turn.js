// Loops whose heads hold a pattern with a default that reads its own name or a later one: the name is new on every turn, so the read throws. Plain Bun prints another output.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "THROWS", error.constructor.name);
  }
}
attempt("for of, const, itself, on the first turn", () => {
  for (const { a = a } of [{}]) return a;
});
attempt("for of, const, itself, on the second turn", () => {
  const seen = [];
  for (const { a = a } of [{ a: 1 }, {}]) seen.push(a);
  return seen;
});
attempt("for of, let, itself, on the second turn", () => {
  const seen = [];
  for (let { a = a } of [{ a: 1 }, {}]) seen.push(a);
  return seen;
});
attempt("for of, const, a later name, on the second turn", () => {
  const seen = [];
  for (const [a = b, b] of [[1, 2], []]) seen.push(a, b);
  return seen;
});
attempt("for in, const, a later name, on the second turn", () => {
  const seen = [];
  for (const [, a = b, b] in { xyz: 1, x: 2 }) seen.push(a, b);
  return seen;
});
attempt("for of, const, itself, on the second turn, with a closure", () => {
  const seen = [];
  for (const { a = a } of [{ a: 1 }, {}]) seen.push(() => a);
  return seen.map(each => each());
});
attempt("a block in a loop, on the second turn", () => {
  const seen = [];
  for (const from of [{ a: 1 }, {}]) {
    const { a = a } = from;
    seen.push(a);
  }
  return seen;
});
