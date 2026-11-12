import Anthropic from "@anthropic-ai/sdk";

const encoder = new TextEncoder();
const events = [
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [],
        model: "stub-model",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
  ],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", world" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
  ],
  ["message_stop", { type: "message_stop" }],
] as const;
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { stream?: boolean; messages: { content: string }[] };
    if (body.stream)
      return new Response(
        encoder.encode(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("")),
        { headers: { "content-type": "text/event-stream" } },
      );
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "stub-model",
      content: [{ type: "text", text: "Hello, " + body.messages[0].content }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  },
});
const client = new Anthropic({ apiKey: "my-key", baseURL: `http://localhost:${server.port}`, maxRetries: 0 });
const message = await client.messages.create({
  max_tokens: 1024,
  messages: [{ role: "user", content: "Claude" }],
  model: "stub-model",
});
console.log(message.content[0].type === "text" ? message.content[0].text : "no text", message.usage.output_tokens);

const stream = client.messages
  .stream({ max_tokens: 1024, messages: [{ role: "user", content: "Claude" }], model: "stub-model" })
  .on("text", text => console.log("text:", text));
const final = await stream.finalMessage();
console.log(final.stop_reason, final.usage.output_tokens, await stream.finalText());
server.stop(true);
try {
  await client.messages.create({ max_tokens: 1, messages: [{ role: "user", content: "x" }], model: "stub-model" });
} catch (error) {
  console.log(error instanceof Anthropic.APIConnectionError, (error as Error).name);
}
