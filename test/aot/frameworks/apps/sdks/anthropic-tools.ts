import Anthropic from "@anthropic-ai/sdk";
import {
  mcpContent,
  mcpMessage,
  mcpResourceToContent,
  mcpResourceToFile,
  mcpTools,
} from "@anthropic-ai/sdk/helpers/beta/mcp";
import { betaMemoryTool } from "@anthropic-ai/sdk/helpers/beta/memory";
import { betaStandardSchemaOutputFormat, betaStandardSchemaTool } from "@anthropic-ai/sdk/helpers/beta/standard-schema";
import { z } from "zod";

type Body = { messages: { role: string; content: unknown }[]; tools?: { name: string }[] };
const inputs: Record<string, unknown> = {
  memory: { command: "create", path: "/memories/note.txt", file_text: "remember this" },
  echo: { text: "hello" },
  square: { n: 7 },
};
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
        [{ type: "tool_use", id: "toolu_1", name: body.tools[0].name, input: inputs[body.tools[0].name] }],
        "tool_use",
      );
    if (body.tools) return reply([{ type: "text", text: "the tool said " + JSON.stringify(last.content) }], "end_turn");
    return reply([{ type: "text", text: JSON.stringify({ ok: true }) }], "end_turn");
  },
});
const client = new Anthropic({ apiKey: "stub", baseURL: `http://localhost:${server.port}`, maxRetries: 0 });
const model = "stub-model";
const text = (message: { content: { type: string; text?: string }[] }) =>
  message.content.map(block => block.text ?? block.type).join();

const files = new Map<string, string>();
const memory = betaMemoryTool({
  view: command => files.get(command.path) ?? "nothing there",
  create: command => (files.set(command.path, command.file_text), `created ${command.path}`),
  str_replace: command => `replaced in ${command.path}`,
  insert: command => `inserted into ${command.path}`,
  delete: command => (files.delete(command.path), `deleted ${command.path}`),
  rename: command => `renamed ${command.old_path}`,
});
console.log(
  text(
    await client.beta.messages.toolRunner({
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: "Remember this" }],
      tools: [memory],
    }),
  ),
  [...files],
);

const square = betaStandardSchemaTool({
  name: "square",
  description: "Squares a number",
  inputSchema: z.object({ n: z.number() }),
  run: ({ n }) => String(n * n),
});
console.log(
  text(
    await client.beta.messages.toolRunner({
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: "Square 7" }],
      tools: [square],
    }),
  ),
);
const checked = await client.beta.messages.parse({
  model,
  max_tokens: 64,
  messages: [{ role: "user", content: "ok?" }],
  output_config: { format: betaStandardSchemaOutputFormat(z.object({ ok: z.boolean() })) },
});
console.log(checked.parsed_output?.ok);

const calls: string[] = [];
const tools = mcpTools(
  [{ name: "echo", description: "Echoes", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
  {
    async callTool(params) {
      calls.push(JSON.stringify(params));
      return { content: [{ type: "text", text: "echoed " + String(params.arguments?.text) }] };
    },
  },
);
console.log(
  text(
    await client.beta.messages.toolRunner({
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: "Echo hello" }],
      tools,
    }),
  ),
  calls,
);
console.log(JSON.stringify(mcpMessage({ role: "user", content: { type: "text", text: "from a prompt" } })));
console.log(JSON.stringify(mcpContent({ type: "image", data: "aGk=", mimeType: "image/png" })));
console.log(
  JSON.stringify(
    mcpResourceToContent({ contents: [{ uri: "file:///a.txt", mimeType: "text/plain", text: "a resource" }] }),
  ),
);
const file = mcpResourceToFile({
  contents: [{ uri: "file:///folder/a.txt", mimeType: "text/plain", text: "a resource" }],
});
console.log(file.name, file.type, file.size, await file.text());
try {
  mcpContent({ type: "audio", data: "aGk=", mimeType: "audio/wav" } as never);
} catch (error) {
  console.log((error as Error).name, (error as Error).message.slice(0, 60));
}
server.stop(true);
