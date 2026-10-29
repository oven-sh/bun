// `return JSON.parse(text)` and `return await response.json()` in an async function that declares its result build objects of the declared type.
interface Point {
  x: number;
  y: number;
}
interface Message {
  point: Point;
  name: string;
  tags: string[];
}
async function parseText(text: string): Promise<Message> {
  return JSON.parse(text);
}
async function readBody(text: string): Promise<Message> {
  return await new Response(text).json();
}
const texts = [
  '{"point":{"x":3,"y":4},"name":"first","tags":["a","b"]}',
  '{"point":{"x":1.5,"y":-2},"name":"second","tags":[]}',
];
let check = 0;
for (let round = 0; round < 20000; round++) {
  const text = texts[round & 1]!;
  const parsed = await parseText(text);
  const read = await readBody(text);
  check = (check + parsed.point.x * 2 + parsed.tags.length + read.point.y + read.name.length) | 0;
}
console.log(check);
