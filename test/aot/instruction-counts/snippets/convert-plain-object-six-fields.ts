// passes plain objects of six properties (number, typed object, array, string, fraction, boolean) to a typed function, which reads all six
type Inner = { n: number };
type Entry = { id: number; inner: Inner; tags: string[]; title: string; score: number; done: boolean };
const operations = 100;
const makeInner = (n: number): Inner => ({ n });
const makeEntry = (id: number, inner: Inner, tags: string[]): Entry => ({ id, inner, tags, title: "typed", score: 1.5, done: false });
const grow = (id: number, inner: Inner, tags: string[]): any => {
  const entry: any = { id };
  entry.inner = inner;
  entry.tags = tags;
  entry.title = "six";
  entry.score = 0.5;
  entry.done = true;
  return entry;
};
const read = (entry: Entry) => entry.id + entry.inner.n + entry.tags.length + entry.title.length + entry.score + (entry.done ? 1 : 0);
const inner = makeInner(7);
const tags = ["x", "y"];
let total = read(makeEntry(1, inner, tags));
let kept: unknown;

kernel: {
  for (let i = 0; i < operations; i++) {
    const entry = grow(i, inner, tags);
    kept = entry;
    total += read(entry);
  }
}

console.log(total, kept === undefined);
