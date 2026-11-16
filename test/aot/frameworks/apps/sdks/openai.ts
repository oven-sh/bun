import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { messages: { content: string }[]; response_format?: unknown };
    const content = body.response_format
      ? JSON.stringify({ name: "party", day: "Friday" })
      : "Hello " + body.messages[0].content;
    return Response.json({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "gpt-4o",
      choices: [
        { index: 0, message: { role: "assistant", content, refusal: null }, finish_reason: "stop", logprobs: null },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  },
});
const client = new OpenAI({ apiKey: "sk-test", baseURL: `http://localhost:${server.port}/v1`, maxRetries: 0 });
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "world" }],
});
console.log(completion.choices[0].message.content, completion.usage?.total_tokens);

const CalendarEvent = z.object({ name: z.string(), day: z.string() });
const format = zodResponseFormat(CalendarEvent, "event");
console.log(format.type, JSON.stringify(format.json_schema.schema));
const parsed = await client.chat.completions.parse({
  model: "gpt-4o",
  messages: [{ role: "user", content: "a party on Friday" }],
  response_format: format,
});
console.log(parsed.choices[0].message.parsed?.name, parsed.choices[0].message.parsed?.day);
server.stop(true);
try {
  await client.models.list();
} catch (error) {
  console.log(error instanceof OpenAI.APIConnectionError, (error as Error).name);
}
