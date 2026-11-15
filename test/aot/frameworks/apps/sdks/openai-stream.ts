import OpenAI from "openai";
import { standardFunction, standardResponseFormat } from "openai/helpers/standard-schema";
import { z } from "zod";

const chunk = (delta: object, finish_reason: string | null = null) => ({
  id: "chatcmpl_1",
  object: "chat.completion.chunk",
  created: 0,
  model: "stub",
  choices: [{ index: 0, delta, finish_reason, logprobs: null }],
});
const chunks = [
  chunk({ role: "assistant", content: "" }),
  chunk({ content: '{"city":' }),
  chunk({ content: '"Par' }),
  chunk({ content: 'is","degrees":20}' }),
  chunk({}, "stop"),
];
const server = Bun.serve({
  port: 0,
  fetch() {
    const bytes = new TextEncoder().encode(
      chunks.map(each => `data: ${JSON.stringify(each)}\n\n`).join("") + "data: [DONE]\n\n",
    );
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (let at = 0; at < bytes.length; at += 41) {
            controller.enqueue(bytes.slice(at, at + 41));
            await Promise.resolve();
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const client = new OpenAI({ apiKey: "stub", baseURL: `http://localhost:${server.port}/v1`, maxRetries: 0 });
const Weather = z.object({ city: z.string(), degrees: z.number() });

const stream = client.chat.completions.stream({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Weather?" }],
  response_format: standardResponseFormat(Weather, "weather"),
});
stream.on("content.delta", ({ delta, snapshot, parsed }) =>
  console.log("delta", JSON.stringify(delta), JSON.stringify(snapshot), JSON.stringify(parsed)),
);
stream.on("content.done", ({ parsed }) => console.log("done", parsed?.city, parsed?.degrees));
const completion = await stream.finalChatCompletion();
console.log(completion.choices[0].finish_reason, completion.choices[0].message.parsed?.city);

const pieces: string[] = [];
for await (const part of await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Weather?" }],
  stream: true,
}))
  pieces.push(part.choices[0].delta.content ?? "-");
console.log(pieces.join("|"));

const tool = standardFunction({
  name: "lookup",
  description: "Looks up",
  parameters: z.object({ id: z.string() }),
  function: ({ id }) => id.toUpperCase(),
});
console.log(
  tool.type,
  tool.function.name,
  JSON.stringify(tool.function.parameters),
  tool.$callback?.({ id: "abc" }),
  JSON.stringify(await tool.$parseRaw('{"id":"x"}')),
);
server.stop(true);
