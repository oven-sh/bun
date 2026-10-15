// Chunks of a host stream are typed arrays. They have a numeric `length`, so a function that asks for `{ length: number }` accepts them.
const own = { length: 7 };
console.log(own.length);
async function count(chunks: AsyncIterable<{ length: number }>) {
  let total = 0;
  for await (const chunk of chunks) total += chunk.length;
  return total;
}
console.log((await Promise.all(new Response("hi").body!.tee().map(count))).join());
async function countToo(chunks: AsyncIterable<{ length: number }>) {
  let total = 0;
  for await (const chunk of chunks) total += chunk.length;
  return total;
}
const [first, second] = new Response("hello").body!.tee();
console.log(await countToo(first), await countToo(second));
