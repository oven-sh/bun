// Async generators created from text at run time have the same built-in next method as compiled ones, so compiled `for await` and `yield*` step them too. They are not compiled generators: each step is an ordinary call.
// Interpreted loops over compiled generators go the other way.
const lines = [];
const show = value => (value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value));

const interpreted = new Function(`
  return {
    async *count(label, limit) {
      for (let i = 0; i < limit; i++) yield label + i;
      return label + " result";
    },
    async *countAfterAwaits(label, limit) {
      for (let i = 0; i < limit; i++) {
        await null;
        yield await Promise.resolve(label + i);
      }
    },
    async *echo(label) {
      let received = yield label + " started";
      while (received !== "stop") received = yield label + " got " + JSON.stringify(received);
      return label + " stopped";
    },
    async *failsAt(label, limit) {
      for (let i = 0; i < limit; i++) yield label + i;
      throw new Error(label + " failed");
    },
    async *relay(source) {
      for await (const value of source) yield "interpreted relay of " + value;
    },
    async *delegate(source) {
      return yield* source;
    },
  };
`)();

async function* count(label, limit) {
  for (let i = 0; i < limit; i++) yield label + i;
  return label + " result";
}

async function* relay(source) {
  for await (const value of source) yield "relay of " + value;
}

async function* delegate(source) {
  const result = yield* source;
  yield "delegate result " + show(result);
}

async function collect(title, source, limit = Infinity) {
  const seen = [];
  try {
    for await (const value of source) {
      seen.push(value);
      if (seen.length >= limit) break;
    }
  } catch (error) {
    seen.push("caught " + show(error));
  }
  lines.push(`${title}: ${seen.join(", ")}`);
}

lines.push("one next method: " + (interpreted.count("", 0).next === count("", 0).next));

await collect("function", interpreted.count("a", 3));
await collect("function, broken off", interpreted.count("b", 3), 2);
await collect("function, awaits inside", interpreted.countAfterAwaits("c", 3));
await collect("function, failure", interpreted.failsAt("d", 2));
await collect("function, empty", interpreted.count("e", 0));
await collect("generator", relay(interpreted.count("f", 3)));
await collect("generator, failure", relay(interpreted.failsAt("g", 1)));
await collect("delegate", delegate(interpreted.count("h", 2)));
await collect("delegate, failure", delegate(interpreted.failsAt("i", 1)));
await collect("interpreted loop over compiled", interpreted.relay(count("j", 3)));
await collect("interpreted delegate to compiled", delegate(interpreted.delegate(count("k", 2))));
await collect("alternating", relay(interpreted.relay(relay(interpreted.count("l", 2)))));

const outer = delegate(interpreted.echo("echo"));
for (const sent of [undefined, 1, { a: 1 }, undefined, "stop", "late"]) lines.push("sent " + show(sent) + ": " + show(await outer.next(sent)));

const order = [];
async function loop(label, source) {
  for await (const value of source) {
    order.push(label + value);
    await null;
  }
}
await Promise.all([loop("x:", count("m", 3)), loop("y:", interpreted.count("n", 3)), loop("z:", interpreted.countAfterAwaits("o", 2)), loop("w:", delegate(interpreted.count("p", 2)))]);
lines.push("four loops at once: " + order.join(", "));

const finished = interpreted.count("q", 1);
await collect("first loop", finished);
await collect("second loop over a finished generator", finished);

console.log(lines.join("\n"));
