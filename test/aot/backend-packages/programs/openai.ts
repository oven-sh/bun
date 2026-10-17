import http from "node:http";
import OpenAI from "openai";
import { listen, readBody } from "./lib_http.ts";

const seen: string[] = [];
const server = http.createServer(async (request, response) => {
  const body = JSON.parse(await readBody(request)) as { stream?: boolean; model: string };
  seen.push(`${request.method} ${request.url} ${request.headers.authorization} stream:${body.stream === true}`);
  if (body.stream) {
    response.setHeader("Content-Type", "text/event-stream");
    for (const word of ["Hel", "lo ", "there"]) response.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { content: word }, finish_reason: null }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  } else {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "Hello there" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
  }
});
const port = await listen(server);
const client = new OpenAI({ apiKey: "smoke", baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 });
const whole = await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }] });
console.log(whole.choices[0]!.message.content, whole.usage?.total_tokens);
let text = "";
for await (const chunk of await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }], stream: true })) text += chunk.choices[0]?.delta.content ?? "";
console.log(text);
server.close();
console.log(seen.join("\n"));
console.log("DONE");
