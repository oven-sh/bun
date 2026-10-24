// trees/sdk/measure.ts <turns> <chunk bytes>: a measure, not a gate: a long answer as the API streams it (text deltas of a few tokens, a ping now and then), read through Stream.fromSSEResponse; the body hands over chunks of the given size. Prints what was read, so that two builds can be seen to do the same work.
import { Stream } from "@anthropic-ai/sdk/core/streaming";
const turns = Number(process.argv[2] ?? 20), size = Number(process.argv[3] ?? 1400);
const ev = (event: string, data: unknown) => "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
let text = ev("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "m", usage: { input_tokens: 1000, output_tokens: 1 } } }) + ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
for (let i = 0; i < 3000; i++) text += ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " word" + (i * 7919 % 1000).toString(36) } }) + (i % 200 ? "" : ev("ping", { type: "ping" }));
text += ev("content_block_stop", { type: "content_block_stop", index: 0 }) + ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3000 } }) + ev("message_stop", { type: "message_stop" });
const all = new TextEncoder().encode(text);
let n = 0, chars = 0;
for (let t = 0; t < turns; t++) {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { if (at >= all.length) { c.close(); return; } c.enqueue(all.subarray(at, at + size)); at += size; } });
  for await (const e of Stream.fromSSEResponse<{ type: string; delta?: { text?: string } }>(new Response(body), new AbortController())) { n++; chars += e.delta?.text?.length ?? 0; }
}
console.error("SAME WORK: " + turns + " turns of " + all.length + " B in chunks of " + size + ": " + n + " events, " + chars + " characters");
