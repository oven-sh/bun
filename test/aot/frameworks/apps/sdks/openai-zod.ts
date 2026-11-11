import OpenAI from "openai";
import { zodFunction, zodResponseFormat, zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

type Body = { messages?: { role: string; content?: unknown }[]; tools?: unknown[]; input?: unknown };
const completion = (message: object, finish_reason: string) =>
  Response.json({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 0,
    model: "stub",
    choices: [{ index: 0, message: { role: "assistant", refusal: null, ...message }, finish_reason, logprobs: null }],
  });
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as Body;
    if (new URL(request.url).pathname.endsWith("/responses"))
      return Response.json({
        id: "resp_1",
        object: "response",
        created_at: 0,
        model: "stub",
        status: "completed",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        parallel_tool_calls: true,
        temperature: 1,
        tool_choice: "auto",
        tools: [],
        top_p: 1,
        output: [
          {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", annotations: [], text: JSON.stringify({ city: "Paris", degrees: 20 }) }],
          },
        ],
      });
    const last = body.messages!.at(-1)!;
    if (body.tools && last.role === "user")
      return completion(
        {
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "add", arguments: JSON.stringify({ a: 2, b: 3 }) } },
          ],
        },
        "tool_calls",
      );
    if (body.tools) return completion({ content: "the tool said " + String(last.content) }, "stop");
    return completion(
      { content: JSON.stringify({ steps: [{ explanation: "add", output: "4" }], final_answer: "4" }) },
      "stop",
    );
  },
});
const client = new OpenAI({ apiKey: "stub", baseURL: `http://localhost:${server.port}/v1`, maxRetries: 0 });

const Step = z.object({ explanation: z.string(), output: z.string() });
const Reasoning = z.object({ steps: z.array(Step), final_answer: z.string() });
const format = zodResponseFormat(Reasoning, "reasoning");
console.log(JSON.stringify(format.json_schema.schema));
const parsed = await client.chat.completions.parse({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "2+2?" }],
  response_format: format,
});
console.log(parsed.choices[0].message.parsed?.final_answer, parsed.choices[0].message.parsed?.steps[0].explanation);

const runner = client.chat.completions.runTools({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Add 2 and 3" }],
  tools: [
    zodFunction({
      name: "add",
      description: "Adds",
      parameters: z.object({ a: z.number(), b: z.number() }),
      function: ({ a, b }) => a + b,
    }),
  ],
});
runner.on("functionToolCall", call => console.log("call", call.name, call.arguments));
runner.on("functionToolCallResult", result => console.log("result", result));
console.log(await runner.finalContent());

const Weather = z.object({ city: z.string(), degrees: z.number() });
const response = await client.responses.parse({
  model: "gpt-4o-mini",
  input: "Weather?",
  text: { format: zodTextFormat(Weather, "weather") },
});
console.log(response.output_parsed?.city, (response.output_parsed?.degrees ?? 0) + 1);
const tool = zodResponsesFunction({
  name: "lookup",
  description: "Looks up",
  parameters: z.object({ id: z.string() }),
});
console.log(tool.type, tool.name, JSON.stringify(tool.parameters));
server.stop(true);
