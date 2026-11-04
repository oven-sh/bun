// `function scan() {}` and its neighbors, handed out on one object by their names, as a scanner is written. They call one another by name, and the holder calls them through the object.
type Reader = { next: () => number; peek: () => number; rest: () => number; setText: (text: string) => void; position: () => number };
function createReader(initial: string): Reader {
  let text = initial;
  let pos = 0;
  return { next, peek, rest, setText, position: () => pos };
  function peek(): number {
    return pos < text.length ? text.charCodeAt(pos) : -1;
  }
  function next(): number {
    const code = peek();
    if (code >= 0) pos++;
    return code;
  }
  function rest(): number {
    let n = 0;
    while (next() >= 0) n++;
    return n;
  }
  function setText(other: string): void {
    text = other;
    pos = 0;
  }
}
function lengthBy(text: string): number {
  const reader = createReader("");
  reader.setText(text);
  reader.next();
  return reader.rest() + reader.position();
}
let total = 0;
for (let i = 0; i < 200; i++) total += lengthBy("x".repeat(i % 7));
const reader = createReader("abc");
const next = reader.next;
console.log(total, next(), reader.next(), next === reader.next, reader.peek(), reader.position(), reader.rest());
