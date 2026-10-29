// A call returns a small object or array, and an await lies between the call and the reads of its fields. While the caller is suspended, only its saved frame refers to the strings and objects in those fields.
// Env: BUN_JSC_scribbleFreeCells=1
interface Tag {
  id: number;
}
type Entry = { flag: boolean; count: number; name: string; tag: Tag | null };

const host = globalThis as unknown as { Bun?: { gc(force: boolean): void }; gc(): void };
const collect: () => void = host.Bun ? () => host.Bun!.gc(true) : host.gc;

function scramble(x: number): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += (x + i) * (x - i);
    if (sum > 1e9) sum -= 1e9;
  }
  return sum;
}

// The functions that create the results are too large to inline.
function createEntry(x: number): Entry {
  let a = scramble(x);
  let b = scramble(x + 1);
  for (let i = 0; i < 2; i++) {
    a += scramble(a & 7);
    b += scramble(b & 7);
    if (a > 1e12) a = 1;
    if (b > 1e12) b = 2;
  }
  return { flag: a > b, count: a & 1023, name: "entry " + (b & 15), tag: a & 1 ? { id: a & 255 } : null };
}

function createNames(x: number): [string, string] {
  let a = scramble(x);
  let b = scramble(x + 1);
  for (let i = 0; i < 2; i++) {
    a += scramble(a & 7);
    b += scramble(b & 7);
    if (a > 1e12) a = 1;
    if (b > 1e12) b = 2;
  }
  return ["first " + (a & 31), "second " + (b & 31)];
}

function createRange(x: number): { low: number; high: number } {
  let a = scramble(x);
  let b = scramble(x + 1);
  for (let i = 0; i < 2; i++) {
    a += scramble(a & 7);
    b += scramble(b & 7);
    if (a > 1e12) a = 1;
    if (b > 1e12) b = 2;
  }
  return { low: a, high: b + 0.5 };
}

// This one returns a new object only after entryOf() has been inlined into it.
function entryOf(flag: boolean, count: number, name: string, tag: Tag | null): Entry {
  return { flag, count, name, tag };
}
function createEntryThroughCall(x: number): Entry {
  let a = scramble(x);
  let b = scramble(x + 1);
  for (let i = 0; i < 2; i++) {
    a += scramble(a & 7);
    b += scramble(b & 7);
    if (a > 1e12) a = 1;
    if (b > 1e12) b = 2;
  }
  return entryOf(a > b, a & 1023, "entry " + (b & 15), a & 1 ? { id: a & 255 } : null);
}

function format(flag: boolean, count: number, name: string, tag: Tag | null): string {
  return flag + " " + count + " " + name + " " + (tag ? tag.id : "none");
}

let spares: Entry[] = [];

// The caller is suspended by the time the collection runs, and the new objects reuse the cells that it freed.
async function pause(): Promise<void> {
  await null;
  collect();
  spares = [];
  for (let i = 0; i < 64; i++) spares.push({ flag: false, count: i, name: "spare " + i, tag: { id: i } });
}

async function pauseAndThrow(): Promise<void> {
  await pause();
  throw new Error("thrown after the pause");
}

async function readAfterAwait(x: number): Promise<string> {
  const entry = createEntry(x);
  await pause();
  return format(entry.flag, entry.count, entry.name, entry.tag);
}

async function readBeforeAndAfterAwait(x: number): Promise<string> {
  const entry = createEntry(x);
  const name = entry.name;
  await pause();
  return name + " " + format(entry.flag, entry.count, entry.name, entry.tag);
}

async function readOneFieldAfterAwait(x: number): Promise<string> {
  const entry = createEntry(x);
  const count = entry.count;
  await pause();
  return count + " " + entry.name;
}

async function readAfterTwoAwaits(x: number): Promise<string> {
  const entry = createEntry(x);
  await pause();
  const name = entry.name;
  await pause();
  return name + " " + (entry.tag ? entry.tag.id : "none");
}

async function readElementsAfterAwait(x: number): Promise<string> {
  const names = createNames(x);
  await pause();
  return names[0] + " " + names[1];
}

async function destructureAfterAwait(x: number): Promise<string> {
  const names = createNames(x);
  await pause();
  const [first, second] = names;
  return first + " " + second;
}

async function readNumbersAfterAwait(x: number): Promise<string> {
  const range = createRange(x);
  await pause();
  return range.low + " " + range.high;
}

async function readAfterInlinedCall(x: number): Promise<string> {
  const entry = createEntryThroughCall(x);
  await pause();
  return format(entry.flag, entry.count, entry.name, entry.tag);
}

async function readInLoop(x: number): Promise<string> {
  let text = "";
  for (let i = 0; i < 3; i++) {
    const entry = createEntry(x + i);
    await pause();
    text += entry.name + (entry.tag ? "#" + entry.tag.id : "") + ";";
  }
  return text;
}

async function readInHandler(x: number): Promise<string> {
  const entry = createEntry(x);
  try {
    await pauseAndThrow();
    return "not thrown";
  } catch (error) {
    return entry.name + " " + (error as Error).message;
  }
}

async function readMatchAfterAwait(x: number): Promise<string> {
  const match = /([a-z]+)-(\d+)/.exec("prefix item-" + x * 3);
  if (!match) return "no match";
  await pause();
  return match[1] + " " + match[2] + " " + match.index;
}

async function readSeveralCallsAfterAwait(x: number): Promise<string> {
  const entry = createEntry(x);
  const other = createEntryThroughCall(x + 1);
  const names = createNames(x + 2);
  const range = createRange(x + 3);
  await pause();
  return [format(entry.flag, entry.count, entry.name, entry.tag), format(other.flag, other.count, other.name, other.tag), names[0], names[1], range.low, range.high].join(" ");
}

async function main(): Promise<void> {
  for (let round = 0; round < 12; round++) {
    console.log(
      [
        await readAfterAwait(round),
        await readBeforeAndAfterAwait(round),
        await readOneFieldAfterAwait(round),
        await readAfterTwoAwaits(round),
        await readElementsAfterAwait(round),
        await destructureAfterAwait(round),
        await readNumbersAfterAwait(round),
        await readAfterInlinedCall(round),
        await readInLoop(round),
        await readInHandler(round),
        await readMatchAfterAwait(round),
        await readSeveralCallsAfterAwait(round),
      ].join(" | "),
    );
  }
}

main().then(undefined, error => console.log("main rejected", error));
