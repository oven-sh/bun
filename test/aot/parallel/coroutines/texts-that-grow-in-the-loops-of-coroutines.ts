// A text that grows in a loop is kept in a builder while the loop runs. In the body of a coroutine the builder lies in the frame as elsewhere: the loop cannot suspend, and the frame may lie elsewhere each time the body goes on.
const said: string[] = [];
const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const sum = (text: string) => { let hash = 7; for (let at = 0; at < text.length; at++) hash = (hash * 31 + text.charCodeAt(at)) | 0; return `${text.length}:${hash}`; };

async function betweenAwaits(turns: number, tag: string): Promise<string> {
  let text = "";
  for (let turn = 0; turn < turns; turn++) text += tag + turn + ",";
  await null;
  for (let turn = 0; turn < turns; turn++) text += words[turn % words.length] + ";";
  await Promise.resolve(tag);
  let other = "";
  for (const word of words) other += word[0] + tag;
  return text + "|" + other;
}
function* yieldsTexts(rows: number): Generator<string, string, number> {
  let all = "";
  for (let row = 0; row < rows; row++) {
    let text = "";
    for (let cell = 0; cell <= row; cell++) text += `${cell}:${words[cell % words.length]} `;
    const sent = yield text;
    for (let time = 0; time < sent; time++) all += text.length + ".";
  }
  return all;
}
function* yieldsInsideTheLoop(): Generator<string> {
  let text = "";
  for (const word of words) { text += word; yield text; }
}
async function* pages(size: number, wide: boolean): AsyncGenerator<string> {
  for (let first = 0; first < words.length; first += size) {
    let text = "";
    for (const word of words.slice(first, first + size)) text += (wide ? "中" : "-") + word.repeat(wide ? 2 : 9) + "\n";
    yield text;
  }
}
async function leavesEarly(limit: number): Promise<string> {
  let text = "";
  try {
    for (let turn = 0; ; turn++) {
      if (turn === limit) throw new RangeError("at " + turn);
      if (turn === 40) break;
      text += turn.toString(36);
    }
  } catch (error) {
    await null;
    return text + "!" + (error as Error).message;
  }
  await null;
  return text;
}
let open: () => void = () => {};
const gate = new Promise<void>(resolve => { open = resolve; });
async function standsWhileTheCollectorRuns(turns: number, tag: string): Promise<string> {
  let text = "";
  for (let turn = 0; turn < turns; turn++) text += tag + turn + ",";
  await gate;
  return text;
}
function resumedAtDepth(steps: Generator<string, string, number>, depth: number): IteratorResult<string, string> {
  return depth ? resumedAtDepth(steps, depth - 1) : steps.next(2);
}

async function main() {
  const together = await Promise.all(words.map((word, place) => betweenAwaits(place * 9, word)));
  for (const text of together) said.push(sum(text));
  const steps = yieldsTexts(12);
  for (let depth = 0; ; depth += 7) {
    const step = resumedAtDepth(steps, depth);
    said.push(sum(step.value));
    if (step.done) break;
  }
  said.push([...yieldsInsideTheLoop()].map(sum).join(" "));
  for (const wide of [false, true]) for await (const page of pages(3, wide)) said.push(sum(page));
  said.push(await leavesEarly(5), await leavesEarly(99), await leavesEarly(0));
  const standing = words.map((word, place) => standsWhileTheCollectorRuns(place * 7 + 1, word));
  Bun.gc(true);
  open();
  for (const text of await Promise.all(standing)) said.push(sum(text));
  const many: Promise<string>[] = [];
  for (let round = 0; round < 300; round++) many.push(betweenAwaits(round % 23, "r" + round));
  let all = 0;
  for (const text of await Promise.all(many)) all = (all * 33 + text.length) | 0;
  said.push(String(all));
  console.log(said.join("\n"));
}
main();
