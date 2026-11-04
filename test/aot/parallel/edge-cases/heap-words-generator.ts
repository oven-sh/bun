// A generator with many yields keeps what lives across them in heap words: parameters, the variable of a loop, lists that have one word one after the other, and what a finally block reads.
function* walk(limit: number, step: number, label: string) {
  try {
    for (let i = 0; i < limit; i += step) {
      yield label + i;
      yield i + 1;
      yield i + 2;
      yield i + 3;
      yield i + 4;
      yield i + 5;
      yield i + 6;
      yield i + 7;
      yield i + 8;
      yield i + 9;
      yield i + 10;
      yield i + 11;
      yield i + 12;
      yield i + 13;
      yield i + 14;
      yield i + 15;
      yield i + 16;
      yield i + 17;
    }
    const first = [label, "first"];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first[1];
    yield first[0];
    yield first.length;
    const second = [label, "second", step];
    yield second[0];
    yield second[1];
    yield second[2];
    yield second[0];
    yield second[1];
    yield second[2];
    yield second[0];
    yield second[1];
    yield second[2];
    yield second[0];
    yield second[1];
    yield second[2];
    yield second[0];
    yield second[1];
    yield second[2];
    yield second[0];
    yield second[1];
    yield second.length;
  } finally {
    console.log("closed", label, limit, step);
  }
}

console.log([...walk(4, 2, "a")].join(" "));

const stopped = walk(2, 1, "b");
let last: unknown;
for (let n = 0; n < 40; n++) last = stopped.next().value;
console.log(last, stopped.return(undefined));

const thrown = walk(2, 1, "c");
console.log(thrown.next().value, thrown.next().value);
try {
  thrown.throw(new Error("stop"));
} catch (error) {
  console.log((error as Error).message);
}
