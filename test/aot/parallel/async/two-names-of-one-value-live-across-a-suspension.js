class Pair {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}

function* yields(start) {
  let first = { x: start };
  const second = first;
  yield first.x;
  const pair = new Pair(first, second);
  first.x += 1;
  yield pair.a.x + pair.b.x;
  yield pair.a === pair.b;
  first = { x: 40 };
  yield [first.x, second.x, first === second];
}

async function awaits(start) {
  let first = { x: start, name: "first" };
  const second = first;
  await null;
  first.x++;
  const same = first === second;
  await null;
  return [first.x, second.x, same, second.name];
}

async function writtenWhileSuspended() {
  let held = { x: 1 };
  const also = held;
  const write = () => {
    held = { x: 9 };
  };
  queueMicrotask(write);
  await new Promise(resolve => setTimeout(resolve, 1));
  return [held.x, also.x, held === also];
}

async function anyValues(value) {
  let first = value;
  const second = first;
  await null;
  const both = [first, second, Object.is(first, second)];
  await null;
  return [...both, first, second];
}

for (let round = 0; round < 3; round++) console.log(JSON.stringify([...yields(round)]));
console.log(JSON.stringify(await awaits(1)), JSON.stringify(await awaits(5)));
console.log(JSON.stringify(await writtenWhileSuspended()));
for (const value of [1, 1.5, "text", null, undefined, NaN, { a: 1 }, [2]]) console.log(JSON.stringify(await anyValues(value)));
