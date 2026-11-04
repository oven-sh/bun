type Node = { kind: "a" | "b" | "c" | "d"; v: number };
async function slow(n: Node): Promise<Node> { return n; }
const log: string[] = [];
async function pick(holder: { node: Node }) {
  const n = holder.node;
  const got = await ((n.kind === "a" || n.kind === "b" || n.kind === "c") ? n : slow(n));
  log.push("picked " + got.kind);
}
const kinds = ["a", "b", "c", "d"] as const;
for (let i = 0; i < 300; i++) { pick({ node: { kind: kinds[i % 4], v: i } }); log.push("behind"); }
await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
console.log(log.slice(0, 8).join(" | "), log.length);
