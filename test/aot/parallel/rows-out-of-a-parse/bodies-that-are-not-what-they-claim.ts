// What is written over `await body.json()` is a claim. A body that breaks it is read as it is.
interface Point {
  x: number;
  y: number;
  label?: string;
}

async function add(bytes: ArrayBuffer): Promise<unknown> {
  const point = (await new Response(bytes).json()) as Point;
  return [point.x + point.y, point.label, JSON.stringify(point)];
}

const texts = [
  '{"x":1,"y":2}',
  '{"x":1,"y":2,"label":"a"}',
  '{"y":2,"x":1}',
  '{"x":"1","y":2}',
  '{"x":null,"y":{"z":3}}',
  '{"x":1}',
  '{"x":1,"y":2,"z":3}',
  '{"x":1,"y":2,"__proto__":{"label":"b"}}',
  '{"x":1,"y":2,"x":5}',
  "[1,2]",
  "7",
  '"text"',
  "null",
  "",
  " ",
  "{",
  '{"x":1,"y":2}x',
  '{"x":1e400,"y":-0}',
];
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    const answer = await add(new TextEncoder().encode(text).buffer as ArrayBuffer).catch((error: Error) => error.name + ": " + error.message);
    if (round === 2) console.log(text, answer);
  }
}
