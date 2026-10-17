// passes plain objects, made by a function that the call does not know, to a typed function, which reads three fields
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
const growToo = (id: number, inner: Inner, tags: string[]): any => {
  const message: any = { id: id + 1 };
  message.inner = inner;
  message.tags = tags;
  return message;
};
const makers: any[] = [grow, growToo];
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const inner = makeInner(7);
const tags = ["x", "y"];
let total = read(makeMessage(1, inner, tags));
let kept: unknown;

kernel: {
  for (let i = 0; i < operations; i++) {
    const message = makers[i & 1](i, inner, tags);
    kept = message;
    total += read(message);
  }
}

console.log(total, kept === undefined);
