// passes plain objects that hold another plain object to a typed function, which reads through both
type Inner = { n: number; next: Inner | null };
type Message = { id: number; inner: Inner; tags: string[] };
const operations = 100;
const makeInner = (n: number): Inner => ({ n, next: null });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const growInner = (n: number): any => {
  const inner: any = { n };
  inner.next = null;
  return inner;
};
const grow = (id: number, inner: unknown, tags: string[]): any => {
  const message: any = { id };
  message.inner = inner;
  message.tags = tags;
  return message;
};
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const tags = ["x", "y"];
let total = read(makeMessage(1, makeInner(7), tags));
let kept: unknown;

kernel: {
  for (let i = 0; i < operations; i++) {
    const message = grow(i, growInner(i), tags);
    kept = message;
    total += read(message);
  }
}

console.log(total, kept === undefined);
