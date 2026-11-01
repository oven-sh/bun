// Values of every kind are made first and read again behind twenty and more awaits or yields, with collections in between.
// Such a value is kept in a word of a cell, not in the frame that every suspension saves: each call has its own cell, a loop stores anew in each turn,
// and what a handler or a finally block reads is what the function held when it threw.
const tick = value => new Promise(resolve => queueMicrotask(() => resolve(value)));
function collect() {
  if (typeof Bun !== "undefined") Bun.gc(true);
}

async function kinds(seed, text, list) {
  const whole = seed * 3;
  const fraction = seed + 0.25;
  const large = seed * 4294967296 + 7;
  const negativeZero = seed > 1e9 ? 1 : -0;
  const word = text + "-" + seed;
  const object = { seed, inner: { text } };
  const made = [seed, text, [seed + 1]];
  const nothing = seed > 1e9 ? 1 : undefined;
  const empty = seed > 1e9 ? 1 : null;
  const big = BigInt(seed) * 12345678901234567890n;
  const mark = Symbol(text);
  const isOdd = seed % 2 === 1;
  const isLong = text.length > 3;
  const add = more => seed + more + made.length;
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) sum += await tick(turn);
  sum += await tick(1); sum += await tick(2); collect(); sum += await tick(3); sum += await tick(4); sum += await tick(5);
  sum += await tick(6); sum += await tick(7); sum += await tick(8); collect(); sum += await tick(9); sum += await tick(10);
  sum += await tick(11); sum += await tick(12); sum += await tick(13); sum += await tick(14); collect(); sum += await tick(15);
  sum += await tick(16); sum += await tick(17); sum += await tick(18); sum += await tick(19); sum += await tick(20);
  collect();
  return [
    sum, whole, fraction, large, Object.is(negativeZero, -0), word, JSON.stringify(object), JSON.stringify(made), nothing, empty, String(big), mark.description,
    isOdd ? "odd" : "even", isLong ? "long" : "short", add(5), seed, text, list.join("+"),
  ].join(" | ");
}

async function inLoops(count) {
  const outside = { count };
  const lines = [];
  for (let turn = 0; turn < count; turn++) {
    const ofTurn = { turn, twice: turn * 2 };
    const name = "turn" + turn;
    await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick();
    if (turn === 1) collect();
    await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick();
    lines.push(name + ":" + ofTurn.twice + ":" + outside.count);
  }
  return lines.join(" ");
}

async function thrown(where) {
  const kept = { where };
  const label = "label" + where;
  let steps = 0;
  try {
    try {
      for (let step = 0; step < 24; step++) {
        steps += await tick(1);
        if (step === where) throw new Error("at " + step);
      }
      await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick();
      await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick();
      if (where < 0) throw new Error("late");
      return "returned " + label + " " + kept.where + " " + steps;
    } finally {
      await tick();
      steps += 100;
      collect();
    }
  } catch (error) {
    await tick();
    return error.message + " " + label + " " + kept.where + " " + steps;
  }
}

function* yields(first) {
  const object = { first };
  const text = "g" + first;
  let sent = 0;
  sent += yield 1; sent += yield 2; sent += yield 3; sent += yield 4; sent += yield 5; sent += yield 6; sent += yield 7; sent += yield 8; sent += yield 9; sent += yield 10;
  sent += yield 11; sent += yield 12; sent += yield 13; sent += yield 14; sent += yield 15; sent += yield 16; sent += yield 17; sent += yield 18; sent += yield 19; sent += yield 20;
  return text + ":" + object.first + ":" + sent;
}

async function* both(first) {
  const object = { first };
  const text = "ag" + first;
  for (let turn = 0; turn < 2; turn++) {
    await tick(); yield turn; await tick(); await tick(); yield turn + 10; await tick(); await tick(); await tick(); await tick(); await tick(); await tick();
    await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); await tick(); yield text + object.first;
  }
}

console.log(await kinds(3, "three", [1, 2]));
console.log((await Promise.all([kinds(4, "four", ["a"]), kinds(5, "fives", []), kinds(6, "six", [null])])).join("\n"));
console.log(await inLoops(3));
console.log((await Promise.all([thrown(2), thrown(23), thrown(-1), thrown(99)])).join("\n"));
const stepped = [yields(1), yields(2)];
let last;
for (let turn = 0; turn < 21; turn++) {
  if (turn === 9) collect();
  last = stepped.map(generator => generator.next(turn));
}
console.log(JSON.stringify(last));
const seen = [];
for await (const value of both(7)) seen.push(value);
console.log(seen.join(" "));
