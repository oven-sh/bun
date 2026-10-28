// A stream: the source waits for each chunk, so every layer above it is suspended when the chunk arrives. Handing the chunk up costs a frame switch per layer, not two jobs.
interface Chunk { kind: string; value: number }
let deliver: (chunk: Chunk) => void = () => {};
let acknowledge: () => void = () => {};
async function* source(count: number): AsyncGenerator<Chunk> {
  for (let i = 0; i < count; i++) yield await new Promise<Chunk>(resolve => { deliver = resolve; });
}
async function* decode(input: AsyncIterable<Chunk>): AsyncGenerator<Chunk> {
  for await (const chunk of input) yield chunk;
}
async function* select(input: AsyncIterable<Chunk>): AsyncGenerator<Chunk> {
  for await (const chunk of input) if (chunk.kind === "chunk") yield chunk;
}
async function* values(input: AsyncIterable<Chunk>): AsyncGenerator<number> {
  for await (const chunk of input) yield chunk.value * 2;
}
async function* forward(input: AsyncGenerator<number>): AsyncGenerator<number> {
  yield* input;
}
async function* guard(input: AsyncIterable<number>): AsyncGenerator<number> {
  try {
    for await (const value of input) yield value + 1;
  } finally {
    finished++;
  }
}
let finished = 0;
async function consume(count: number): Promise<number> {
  let sum = 0;
  for await (const value of guard(forward(values(select(decode(source(count))))))) {
    sum = (sum + value) | 0;
    acknowledge();
  }
  return sum;
}
async function feed(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const acknowledged = new Promise<void>(resolve => { acknowledge = resolve; });
    deliver({ kind: "chunk", value: i });
    await acknowledged;
  }
}
const count = 40_000;
const consumed = consume(count);
await feed(count);
console.log(await consumed, finished);
