// passes a typed object whose type is lost to a typed function, which reads three fields
type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[] };
const operations = 100;
const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const grow = (id: number, inner: Inner, tags: string[]): any => {
  const message: any = { id };
  message.inner = inner;
  message.tags = tags;
  return message;
};
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const inner = makeInner(7);
const tags = ["x", "y"];
let total = read(grow(1, inner, tags));
const lost: any = makeMessage(5, inner, tags);

kernel: {
  for (let i = 0; i < operations; i++) total += read(lost);
}

console.log(total);
