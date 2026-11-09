import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat, betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

type Body = { messages: { role: string; content: unknown }[]; tools?: { name: string }[] };
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
    const last = body.messages.at(-1)!;
    if (body.tools && typeof last.content === "string")
      return reply(
        [{ type: "tool_use", id: "toolu_1", name: body.tools[0].name, input: { city: "Paris", unit: "celsius" } }],
        "tool_use",
      );
    if (body.tools) return reply([{ type: "text", text: "the tool said " + JSON.stringify(last.content) }], "end_turn");
    return reply(
      [{ type: "text", text: JSON.stringify({ name: "Ada", age: 36, tags: ["math"], address: { city: "London" } }) }],
      "end_turn",
    );
  },
});
const client = new Anthropic({ apiKey: "stub", baseURL: `http://localhost:${server.port}`, maxRetries: 0 });
const model = "stub-model";

const person = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
    tags: { type: "array", items: { type: "string" } },
    address: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
  },
  required: ["name", "age", "tags", "address"],
  additionalProperties: false,
} as const;

const message = await client.messages.parse({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "Who?" }],
  output_config: { format: jsonSchemaOutputFormat(person) },
});
const parsed = message.parsed_output;
console.log(parsed?.name.toUpperCase(), (parsed?.age ?? 0) + 1, parsed?.tags.join(), parsed?.address.city);

const beta = await client.beta.messages.parse({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "Who?" }],
  output_config: { format: betaJSONSchemaOutputFormat(person) },
});
console.log(beta.parsed_output?.name, beta.parsed_output?.address.city.length);

const weather = betaTool({
  name: "weather",
  description: "The weather in a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" }, unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    required: ["city"],
    additionalProperties: false,
  },
  run: ({ city, unit }) => `${city}: 20 ${unit ?? "celsius"}`,
});
const final = await client.beta.messages.toolRunner({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "Weather in Paris?" }],
  tools: [weather],
});
console.log(final.content.map(block => (block.type === "text" ? block.text : block.type)).join());
console.log("input_schema" in weather ? JSON.stringify(weather.input_schema) : "none", weather.name);
server.stop(true);
