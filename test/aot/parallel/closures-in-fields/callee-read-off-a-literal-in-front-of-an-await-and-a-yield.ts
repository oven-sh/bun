// `reader.take(await more())`: the callee is read, the function suspends, and the call comes when it goes on. What the call needs of the closure has to come through the suspension.
type Reader = { take: (n: number) => number; left: () => number };
function makeReader(total: number): Reader {
  let rest = total;
  return { take: (n: number) => (rest -= n), left: () => rest };
}
async function more(k: number): Promise<number> {
  await null;
  return k;
}
async function* steps(reader: Reader): AsyncGenerator<number> {
  while (reader.left() > 0) yield reader.take(await more(2));
}
function* plain(reader: Reader): Generator<number, void, number> {
  while (reader.left() > 0) reader.take(yield reader.left());
}
async function drain(readers: Reader[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < readers.length; i++) {
    for await (const left of steps(readers[i])) total += left;
    total += readers[i].take(await more(i));
  }
  return total;
}
const readers: Reader[] = [];
for (let i = 0; i < 12; i++) readers.push(makeReader(i));
const one = makeReader(7);
const walk = plain(one);
let seen = "";
for (let step = walk.next(); !step.done; step = walk.next(3)) seen += step.value + ",";
console.log(await drain(readers), seen, one.left());
