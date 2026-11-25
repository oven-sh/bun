import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

type Body = {
  messages: { role: string; content: unknown }[];
  tools?: { name: string }[];
  output_config?: unknown;
  output_format?: unknown;
};
const asked: string[] = [];
const reply = (content: unknown[], stop_reason: string) =>
  Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "stub",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as Body;
    asked.push(JSON.stringify(body.output_config ?? body.output_format ?? body.tools ?? null));
    const last = body.messages.at(-1)!;
    if (body.tools && typeof last.content === "string")
      return reply([{ type: "tool_use", id: "toolu_1", name: body.tools[0].name, input: { a: 2, b: 3 } }], "tool_use");
    if (body.tools) return reply([{ type: "text", text: "the tool said " + JSON.stringify(last.content) }], "end_turn");
    if (last.content === "answer badly")
      return reply([{ type: "text", text: JSON.stringify({ answer: "four" }) }], "end_turn");
    return reply(
      [{ type: "text", text: JSON.stringify({ answer: 4, steps: ["2", "+", "2"], unit: "none" }) }],
      "end_turn",
    );
  },
});
const client = new Anthropic({ apiKey: "stub", baseURL: `http://localhost:${server.port}`, maxRetries: 0 });
const model = "stub-model";

const Answer = z.object({
  answer: z.number(),
  steps: z.array(z.string()).min(1),
  unit: z.enum(["none", "meters"]).optional(),
});
const message = await client.messages.parse({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "What is 2+2?" }],
  output_config: { format: zodOutputFormat(Answer) },
});
console.log(message.parsed_output?.answer, message.parsed_output?.steps.join(""), message.parsed_output?.unit);

const beta = await client.beta.messages.parse({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "What is 2+2?" }],
  output_config: { format: betaZodOutputFormat(Answer) },
});
console.log(beta.parsed_output?.answer, beta.parsed_output?.steps.length);

try {
  await client.messages.parse({
    model,
    max_tokens: 64,
    messages: [{ role: "user", content: "answer badly" }],
    output_config: { format: zodOutputFormat(Answer) },
  });
} catch (error) {
  console.log((error as Error).name, (error as Error).message.split("\n")[0].slice(0, 60));
}

const add = betaZodTool({
  name: "add",
  description: "Adds two numbers",
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  run: ({ a, b }) => String(a + b),
});
const runner = client.beta.messages.toolRunner({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "Add 2 and 3" }],
  tools: [add],
});
for await (const turn of runner) console.log(turn.stop_reason, turn.content.map(block => block.type).join());
const final = await runner;
console.log(final.content.map(block => (block.type === "text" ? block.text : block.type)).join());
for (const line of asked) console.log(line);
server.stop(true);
