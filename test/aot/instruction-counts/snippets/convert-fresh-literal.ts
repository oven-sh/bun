// passes object literals typed any, which nothing else holds, to a typed function, which reads three fields
type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[] };
const operations = 100;
const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const inner = makeInner(7);
const tags = ["x", "y"];
let total = read(makeMessage(1, inner, tags));

kernel: {
  for (let i = 0; i < operations; i++) {
    const message: any = { id: i, inner, tags };
    total += read(message);
  }
}

console.log(total);
