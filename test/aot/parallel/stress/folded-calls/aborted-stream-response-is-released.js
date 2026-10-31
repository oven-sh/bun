// The body of "client abort of a streaming Response releases the body stream it held (async handler)", and, when a stream survives, the chain of holders from a root to it.
const stash = new WeakMap(), streams = [];
const respond = () => {
  const stream = new ReadableStream({ pull(controller) { controller.enqueue("data: x\n\n"); return new Promise(() => {}); } });
  streams.push(new WeakRef(stream));
  const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  stash.set(stream, response);
  return response;
};
const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: async () => { await Promise.resolve(); return respond(); } });
// One more than are counted: a stale word on the stack can name the last stream for as long as the process runs.
for (let i = 0; i < 9; i++) {
  const ac = new AbortController();
  const res = await fetch(server.url, { signal: ac.signal });
  const reader = res.body.getReader();
  await reader.read();
  ac.abort();
  await reader.closed.catch(() => {});
}
await server.stop();
streams.length = 8;
let alive = 8;
// A collection that starts under a resumed async function scans that call's native frames too, and a stale word in a slot they never write can name the last stream. A timer's callback has no such frame above it.
for (let i = 0; i < 20 && alive > 0; i++) { await new Promise(resolve => setTimeout(() => { Bun.gc(true); resolve(); }, 1)); alive = streams.filter(ref => ref.deref() !== undefined).length; }
console.log("alive", alive, "which", streams.map((ref, i) => (ref.deref() !== undefined ? i : "")).join(""));
if (alive > 0) {
  const s = Bun.generateHeapSnapshot();
  const fields = s.nodes.length / (s.nodes.length % 4 === 0 && s.type !== "GCDebugging" ? 4 : 7) ? (s.type === "GCDebugging" ? 7 : 4) : 4;
  const name = new Map(), holders = new Map();
  for (let i = 0; i < s.nodes.length; i += fields) name.set(s.nodes[i], s.nodeClassNames[s.nodes[i + 2]]);
  for (let i = 0; i < s.edges.length; i += 4) {
    const [from, to, type, data] = [s.edges[i], s.edges[i + 1], s.edgeTypes[s.edges[i + 2]], s.edges[i + 3]];
    if (!holders.has(to)) holders.set(to, []);
    holders.get(to).push([from, type, type === "Property" || type === "Variable" ? s.edgeNames[data] : type === "Index" ? data : ""]);
  }
  const targets = [...name].filter(([, n]) => n === "ReadableStream").map(([id]) => id);
  console.log("ReadableStream cells in the snapshot:", targets.length);
  for (const target of targets) {
    // Breadth first from the target towards the root (id 0).
    const via = new Map([[target, null]]); let queue = [target], found = false;
    while (queue.length && !found) { const next = []; for (const id of queue) { for (const [from, type, label] of holders.get(id) ?? []) { if (via.has(from)) continue; via.set(from, [id, type, label]); if (from === 0) { found = true; break; } next.push(from); } if (found) break; } queue = next; }
    if (!found) { console.log("  no chain from the root to", target); continue; }
    const chain = []; for (let id = 0; id !== target; ) { const [to, type, label] = via.get(id); chain.push(`${name.get(id) ?? "<root>"} --${type}${label === "" ? "" : " " + label}--> `); id = to; }
    console.log("  " + chain.join("") + "ReadableStream");
  }
}
process.exit(0);
