// An async function, a generator and an async generator read the same fields, variables and captures in front of a suspension and behind it.
// Some never change, some are changed by other code while the function is suspended, and some by the function itself. Each line: what was read on both sides.
interface Entry { readonly id: number; readonly name: string; readonly tags: readonly string[]; weight: number; note: string | undefined }

const fixedLimit: number = Number("40");
let changing = 1;

function makeEntry(id: number): Entry {
  return { id, name: "entry-" + (id & 3), tags: ["a", id & 1 ? "odd" : "even"], weight: id * 3, note: undefined };
}

function scoreOf(entry: Entry): number {
  return entry.weight * 2 + entry.name.length + entry.tags.length + (entry.id < fixedLimit ? 1 : 0);
}

async function awaits(entry: Entry, gate: Promise<number> | number): Promise<string> {
  const before = scoreOf(entry) + changing;
  const noteBefore = entry.note;
  const bias = await gate;
  const after = scoreOf(entry) + changing;
  entry.weight += bias;
  const own = scoreOf(entry);
  await undefined;
  return [before, noteBefore, after, entry.note, own, scoreOf(entry), entry.tags[1]].join(" ");
}

function* yields(entry: Entry): Generator<number, string, number> {
  const before = scoreOf(entry) + changing;
  const sent = yield before;
  const after = scoreOf(entry) + changing;
  entry.weight += sent;
  yield after;
  return [before, after, scoreOf(entry), entry.name, entry.note].join(" ");
}

async function* yieldsAndAwaits(entry: Entry, gate: number): AsyncGenerator<number, string, void> {
  yield scoreOf(entry) + changing;
  const bias = await gate;
  yield scoreOf(entry) + changing + bias;
  return [scoreOf(entry), entry.name, entry.note, entry.tags.length].join(" ");
}

function makeCounter(step: number): (gate: number) => Promise<string> {
  let calls = 0;
  return async gate => {
    const before = calls + step;
    calls += step;
    const bias = await gate;
    const after = calls + step;
    calls += bias;
    return [before, after, calls].join(" ");
  };
}

for (let id = 38; id < 43; id++) {
  const entry = makeEntry(id);
  const pending = awaits(entry, id & 1 ? Promise.resolve(5) : 5);
  entry.weight += 100;
  entry.note = "noted " + id;
  changing += 10;
  console.log("awaits", await pending);

  const steps = yields(entry);
  const first = steps.next(0).value;
  entry.weight -= 7;
  changing += 1;
  const second = steps.next(4).value;
  entry.note = undefined;
  console.log("yields", first, second, steps.next(0).value);

  const stream = yieldsAndAwaits(entry, 2);
  const seen: (number | string)[] = [];
  for (;;) {
    const step = await stream.next();
    seen.push(step.value);
    entry.weight += 1;
    entry.note = "step " + seen.length;
    changing += 2;
    if (step.done) break;
  }
  console.log("yieldsAndAwaits", seen.join(" | "));
}

const counted = makeCounter(3);
const both = [counted(1), counted(2)];
console.log("captured", (await Promise.all(both)).join(" | "), "|", await counted(4));
