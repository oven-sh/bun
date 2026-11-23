// A string that is read out of a text while the text still grows in its loop is a string of its own: it may be read behind an await or a yield, where the builder in which the text grew is long gone.
function same(value: string): string {
  return value;
}
async function byFunction(limit: number): Promise<string> {
  const turns = limit | 0;
  let text = "", kept = "", at = 0;
  do {
    text += at + ",";
    kept = same(text);
    at = (at + 1) | 0;
  } while (at < turns);
  await null;
  Bun.gc(true);
  return kept.length + ":" + text.length;
}
async function byString(limit: number): Promise<string> {
  const turns = limit | 0;
  let text = "", kept = "", at = 0;
  do {
    text += at + ",";
    kept = String(text);
    at = (at + 1) | 0;
  } while (at < turns);
  await null;
  Bun.gc(true);
  return kept.length + ":" + text.length;
}
async function keptInList(limit: number): Promise<string> {
  const turns = limit | 0;
  const all: string[] = [];
  let text = "", kept = "", at = 0;
  do {
    text += at + ",";
    kept = same(text);
    all.push(kept);
    at = (at + 1) | 0;
  } while (at < turns);
  await null;
  Bun.gc(true);
  return kept.length + ":" + text.length + ":" + all.length + ":" + all[3];
}
async function* inAsyncGenerator(limit: number): AsyncGenerator<string, void, void> {
  const turns = limit | 0;
  let text = "", kept = "", at = 0;
  do {
    text += at + ",";
    kept = same(text);
    at = (at + 1) | 0;
  } while (at < turns);
  yield "first";
  await null;
  Bun.gc(true);
  yield kept.length + ":" + text.length;
}
async function twoLoops(limit: number): Promise<string> {
  const turns = limit | 0;
  let text = "", kept = "", at = 0;
  do {
    text += at + ",";
    kept = same(text);
    at = (at + 1) | 0;
  } while (at < turns);
  await null;
  do {
    text += at + ";";
    kept = same(text);
    at = (at - 1) | 0;
  } while (at > 0);
  await null;
  Bun.gc(true);
  return kept.length + ":" + text.length;
}
function* inGenerator(): Generator<number, string, void> {
  let text = "", kept = "", at = 0;
  do {
    text += at + ",";
    kept = same(text);
    at = (at + 1) | 0;
  } while (at < 40);
  yield at;
  return kept.length + ":" + text.length;
}
async function main() {
  const limit = JSON.parse("40");
  console.log(await byFunction(limit), await byString(limit), await keptInList(limit), await twoLoops(limit));
  for await (const answer of inAsyncGenerator(limit)) console.log(answer);
  const steps = inGenerator();
  console.log(String(steps.next().value), String(steps.next().value));
}
main();
