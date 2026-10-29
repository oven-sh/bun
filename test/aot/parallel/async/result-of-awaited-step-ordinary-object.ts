// The result of an awaited step is an ordinary object.
async function* count(limit: number) {
  for (let i = 0; i < limit; i++) yield i % 2 ? "odd " + i : i;
  return { last: limit };
}

function* countAtOnce(limit: number) {
  for (let i = 0; i < limit; i++) yield i * 10;
  return "end";
}

function describe(result: object) {
  return JSON.stringify({
    keys: Object.keys(result),
    names: Reflect.ownKeys(result).map(String),
    descriptors: Object.getOwnPropertyDescriptors(result),
    isPlain: Object.getPrototypeOf(result) === Object.prototype,
    isExtensible: Object.isExtensible(result),
    hasValue: "value" in result && Object.hasOwn(result, "value"),
    hasThen: "then" in result,
    text: JSON.stringify(result),
    tag: Object.prototype.toString.call(result),
  });
}

async function keepResults(limit: number) {
  const generator = count(limit);
  const results: IteratorResult<unknown>[] = [];
  for (;;) {
    const result = await generator.next();
    results.push(result);
    if (result.done) break;
  }
  results.push(await generator.next());
  return results;
}

async function changeResults() {
  const generator = count(4);
  const first: any = await generator.next();
  first.extra = "added";
  delete first.done;
  first.done = "again";

  const second: any = await generator.next();
  Object.freeze(second);
  let refused = "nothing";
  try {
    second.value = 1;
  } catch (error) {
    refused = (error as Error).constructor.name;
  }

  const third: any = await generator.next();
  Object.defineProperty(third, "value", { get: () => "from a getter", enumerable: false });

  const { value, ...rest } = (await generator.next()) as any;
  return [describe(first), describe(second), refused, third.value, describe(third), value, JSON.stringify(rest), JSON.stringify({ ...second })];
}

async function drain(iterator: Iterator<unknown> | AsyncIterator<unknown>) {
  const seen: unknown[] = [];
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) {
      seen.push(["returned", value]);
      return seen;
    }
    seen.push(value);
  }
}

async function readByComputedName(names: string[]) {
  const generator = count(names.length);
  const read: unknown[] = [];
  for (const name of names) {
    const result: Record<string, unknown> = (await generator.next()) as any;
    read.push(result[name]);
  }
  return read;
}

const results = await keepResults(3);
for (const result of results) console.log(describe(result));
console.log(new Set(results).size, results[0] === results[1]);
for (const line of await changeResults()) console.log(line);
for (let round = 0; round < 3; round++) {
  console.log(JSON.stringify(await drain(count(3 + round))));
  console.log(JSON.stringify(await drain(countAtOnce(2 + round))));
  console.log(JSON.stringify(await drain([1, "two", null][Symbol.iterator]())));
}
console.log(JSON.stringify(await readByComputedName(["value", "done", "toString", "missing"]).then(read => read.map(String))));
