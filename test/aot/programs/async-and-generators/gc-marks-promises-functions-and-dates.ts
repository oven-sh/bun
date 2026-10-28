interface Note {
  text: string;
}

const host = globalThis as unknown as { Bun?: { gc(force: boolean): void }; gc(): void };
const collect: () => void = host.Bun ? () => host.Bun!.gc(true) : host.gc;

class Tagged<T> extends Promise<T> {
  tag: Note = { text: "tagged" };
}

const count = 3_000;
const seen: string[] = [];

function note(kind: string, i: number): Note {
  return { text: kind + "-" + i };
}

async function waitsFor(input: Promise<Note>, own: Note): Promise<void> {
  const value = await input;
  seen.push(own.text + "/" + value.text);
}

function join(this: Note, other: Note): string {
  return this.text + "+" + other.text;
}

function churn(rounds: number): number {
  let kept = 0;
  for (let round = 0; round < rounds; round++) {
    const garbage: unknown[] = [];
    for (let i = 0; i < 20_000; i++) {
      switch (i & 7) {
        case 0:
          garbage.push(Promise.resolve(i));
          break;
        case 1:
          garbage.push(() => i + round);
          break;
        case 2:
          garbage.push(new Date(i));
          break;
        case 3:
          garbage.push(new Promise<number>(() => {}).then(value => value + i));
          break;
        case 4:
          garbage.push({ text: "garbage-" + i });
          break;
        case 5:
          garbage.push([i, round]);
          break;
        case 6:
          garbage.push(join.bind({ text: "a" }, { text: "b" }));
          break;
        default:
          garbage.push("s" + i + round);
      }
    }
    kept += garbage.length;
  }
  return kept;
}

const fulfilled: Promise<Note>[] = [];
const resolvers: ((value: Note) => void)[] = [];
const closures: (() => string)[] = [];
const bound: (() => string)[] = [];
const dates: Date[] = [];
const tagged: Tagged<number>[] = [];
const functions: Function[] = [];
const UntypedPromise = Promise as any;

for (let i = 0; i < count; i++) {
  const capability = UntypedPromise.withResolvers();
  const untyped = note("untyped", i);
  resolvers.push(capability.resolve);
  UntypedPromise.prototype.finally.call(
    capability.promise.then(
      (value: Note) => void seen.push(untyped.text + "/" + value.text),
      () => void seen.push("rejected/" + untyped.text),
    ),
    () => void seen.push("finally/" + untyped.text),
  );

  fulfilled.push(Promise.resolve(note("fulfilled", i)));

  const handled = note("handled", i);
  new Promise<Note>(resolve => void resolvers.push(resolve))
    .then(value => {
      seen.push(handled.text + "/" + value.text);
      return value;
    })
    .finally(() => void seen.push("finally/" + handled.text));

  void waitsFor(new Promise<Note>(resolve => void resolvers.push(resolve)), note("awaiting", i));

  const captured = note("captured", i);
  closures.push(() => captured.text);
  bound.push(join.bind(note("this", i), note("argument", i)));
  dates.push(Object.assign(new Date(i * 1000), { note: note("date", i), more: note("more", i) }));
  tagged.push(Object.assign(new Tagged<number>(resolve => resolve(i)), { extra: note("extra", i) }));
  functions.push(Object.assign(function () {}, { note: note("function", i) }));
  functions.push(Object.assign(Math.max.bind(null, i), { note: note("native", i) }));
}

let allocated = 0;
for (let round = 0; round < 4; round++) {
  allocated += churn(6);
  collect();
}

let checked = 0;
function expect(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("expected " + expected + ", got " + actual);
  checked++;
}

for (let i = 0; i < count; i++) {
  expect((await fulfilled[i]!).text, "fulfilled-" + i);
  expect(closures[i]!(), "captured-" + i);
  expect(bound[i]!(), "this-" + i + "+argument-" + i);
  const date = dates[i]! as Date & { note: Note; more: Note };
  expect(date.note.text + date.more.text + date.getTime(), "date-" + i + "more-" + i + i * 1000);
  const promise = tagged[i]! as Tagged<number> & { extra: Note };
  expect(promise.tag.text + promise.extra.text + (await promise), "taggedextra-" + i + i);
  expect((functions[2 * i] as Function & { note: Note }).note.text, "function-" + i);
  expect((functions[2 * i + 1] as Function & { note: Note }).note.text, "native-" + i);
}

for (let i = 0; i < resolvers.length; i++) resolvers[i]!(note("resolved", i));
allocated += churn(2);
for (let turn = 0; turn < 32; turn++) await null;
seen.sort();
console.log(checked, allocated, seen.length, seen[0], seen[count], seen[2 * count], seen[3 * count], seen[4 * count], seen[seen.length - 1]);
