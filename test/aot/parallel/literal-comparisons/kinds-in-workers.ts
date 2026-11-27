// Kinds that a worker and its starter compare with literals: both hold the same texts in cells of their own.
type Kind = "open" | "close" | "move" | "x" | "\u4e2d" | "a kind that only workers send";
type Message = { type: Kind; size: number };
function count(list: Message[]): Record<string, number> {
  let open = 0, close = 0, move = 0, x = 0, wide = 0, other = 0, rest = 0;
  for (const m of list) {
    if (m.type === "open") open += m.size;
    if (m.type === "close") close += m.size;
    if (m.type === "move") move += m.size;
    if (m.type === "x") x += m.size;
    if (m.type === "\u4e2d") wide += m.size;
    if (m.type === "a kind that only workers send") other += m.size;
    if (m.type !== "open" && m.type !== "close" && m.type !== "move") rest++;
  }
  return { open, close, move, x, wide, other, rest };
}
function make(n: number): Message[] {
  const kinds: Kind[] = ["open", "close", "move", "x", "\u4e2d"];
  if (!Bun.isMainThread) kinds.push("a kind that only workers send");
  return Array.from({ length: n }, (_, i) => ({ type: kinds[i % kinds.length]!, size: i % 7 }));
}
if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  const { promise, resolve } = Promise.withResolvers<{ made: Message[]; counted: unknown }>();
  worker.onmessage = event => resolve(event.data);
  const mine = make(60);
  worker.postMessage(mine);
  const { made, counted } = await promise;
  console.log("mine, here", JSON.stringify(count(mine)));
  console.log("mine, there", JSON.stringify(counted));
  console.log("theirs, here", JSON.stringify(count(made)));
  console.log("both", JSON.stringify(count([...mine, ...made, ...structuredClone(made), ...(JSON.parse(JSON.stringify(made)) as Message[])])));
  worker.terminate();
} else {
  self.onmessage = event => postMessage({ made: make(60), counted: count(event.data) });
}
export {};
