// What a try block stores into an object before it throws shows in the catch block of a generator that keeps the object in a heap word from its first yield on.
function refuse(): void {
  throw new Error("refused");
}

function* count(start: number) {
  const box = { n: start };
  try {
    box.n = start + 1;
    refuse();
    box.n = -1;
  } catch {
    box.n += 10;
  }
  yield box.n;
  yield box.n + 1;
  yield box.n + 2;
  yield box.n + 3;
  yield box.n + 4;
  yield box.n + 5;
  yield box.n + 6;
  yield box.n + 7;
  yield box.n + 8;
  yield box.n + 9;
  yield box.n + 10;
  yield box.n + 11;
  yield box.n + 12;
  yield box.n + 13;
  yield box.n + 14;
  yield box.n + 15;
  yield box.n + 16;
  yield box.n + 17;
}

console.log([...count(1)].join(" "));
