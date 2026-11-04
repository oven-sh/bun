// a small generator steps a generator of its own kind without end, with a number and with what its parameter is not: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
function* down(by: number, n: number): Generator<number, void, unknown> {
  turns++;
  if (limit && turns >= limit) {
    yield n;
    return;
  }
  yield* down(by, n + by);
}
function deed(by: unknown) {
  turns = 0;
  try {
    for (const v of down(by as number, 0)) return String(v);
    return "none";
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed(1));
for (let i = 0; i < 3; i++) console.log(deed(i & 1 ? 2 : "s"));
limit = 5;
console.log(deed(1));
console.log(deed("s"));
