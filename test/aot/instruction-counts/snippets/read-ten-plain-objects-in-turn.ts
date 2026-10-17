// passes ten plain objects in turn to a typed function again and again, which reads three fields
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
let total = read(makeMessage(1, inner, tags));
const ten: any[] = [];
for (let i = 0; i < 10; i++) ten.push(grow(i, inner, tags));

kernel: {
  for (let i = 0; i < operations; i++) total += read(ten[i % 10]);
}

console.log(total);
