import Anthropic from "@anthropic-ai/sdk";

const events: [string, object][] = [
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
  ],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }],
  ["ping", { type: "ping" }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", wörld" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  [
    "content_block_start",
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_1", name: "add", input: {} },
    },
  ],
  [
    "content_block_delta",
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"a": 2,' } },
  ],
  [
    "content_block_delta",
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: ' "b": 3}' } },
  ],
  ["content_block_stop", { type: "content_block_stop", index: 1 }],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 9 } },
  ],
  ["message_stop", { type: "message_stop" }],
];
const server = Bun.serve({
  port: 0,
  fetch() {
    const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    const bytes = new TextEncoder().encode(text);
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (let at = 0; at < bytes.length; at += 37) {
            controller.enqueue(bytes.slice(at, at + 37));
            await Promise.resolve();
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const client = new Anthropic({ apiKey: "stub", baseURL: `http://localhost:${server.port}`, maxRetries: 0 });
const params = {
  model: "stub-model",
  max_tokens: 64,
  messages: [{ role: "user" as const, content: "Hi" }],
};

const stream = client.messages.stream(params);
stream.on("text", (delta, snapshot) => console.log("text", JSON.stringify(delta), JSON.stringify(snapshot)));
stream.on("inputJson", (delta, snapshot) => console.log("inputJson", JSON.stringify(delta), JSON.stringify(snapshot)));
stream.on("contentBlock", block => console.log("contentBlock", block.type));
stream.on("message", message => console.log("message", message.stop_reason));
const final = await stream.finalMessage();
console.log(JSON.stringify(final.content), final.usage.output_tokens, await stream.finalText());

const kinds: string[] = [];
for await (const event of await client.messages.create({ ...params, stream: true })) kinds.push(event.type);
console.log(kinds.join());

const aborted = client.messages.stream(params);
aborted.on("text", () => aborted.abort());
console.log(
  await aborted.finalMessage().then(
    () => "finished",
    error => (error as Error).name,
  ),
);
server.stop(true);
