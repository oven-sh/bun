// A library that waits for the end of a response hangs a property of its own on it. The server's reads under its symbols stay remembered on such a response: they miss at the first ones alone.
// COUNT: operation:operationAOTGetByIdAndCache <= 900
import { createServer, request, Agent } from "node:http";

function attach(message, listener) {
  const queue = [listener];
  message.__onFinished = queue;
  message.on("finish", () => {
    for (const one of queue) one(message);
  });
}

let finished = 0;
const server = createServer((incoming, response) => {
  attach(response, () => finished++);
  response.statusCode = 404;
  response.end("no");
});

const agent = new Agent({ keepAlive: true, maxSockets: 1 });
const ask = port =>
  new Promise((resolve, reject) => {
    request({ port, agent, path: "/" }, answer => {
      let text = "";
      answer.on("data", part => (text += part));
      answer.on("end", () => resolve(answer.statusCode + text));
    })
      .on("error", reject)
      .end();
  });

server.listen(0, async () => {
  const { port } = server.address();
  const seen = new Map();
  for (let times = 0; times < 1500; times++) {
    const answer = await ask(port);
    seen.set(answer, (seen.get(answer) ?? 0) + 1);
  }
  console.log([...seen], finished);
  agent.destroy();
  server.close();
});
