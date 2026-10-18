// passes non-extensible plain objects that hold a typed object and an array to a typed function, which reads three fields
type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[] };
const operations = 100;
const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const grow = (id: number, inner: Inner, tags: string[]): any => {
  const message: any = { id };
  message.inner = inner;
  message.tags = tags;
  Object.preventExtensions(message);
  return message;
};
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const inner = makeInner(7);
const tags = ["x", "y"];
let total = read(makeMessage(1, inner, tags));
let kept: unknown;

kernel: {
  for (let i = 0; i < operations; i++) {
    const message = grow(i, inner, tags);
    kept = message;
    total += read(message);
  }
}

console.log(total, kept === undefined);
