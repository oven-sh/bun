import http from "node:http";
import { finished } from "node:stream";
const turns = Number(process.argv[2] ?? 60);
const lines = [];
let deed = null;
let asked = 0;
class Asked extends http.IncomingMessage { get on() { asked++; return super.on; } }
const server = http.createServer({ IncomingMessage: Asked }, async (request, response) => {
  const tampering = deed;
  deed = null;
  let said;
  try {
    tampering?.(request);
    let seen = 0;
    for await (const chunk of request) seen += chunk.length;
    said = "drained " + seen;
  } catch (error) {
    said = error.code ?? error.name;
  }
  response.end(said);
});
await new Promise(resolve => server.listen(0, resolve));
const send = () =>
  new Promise(resolve => {
    const sent = http.request({ port: server.address().port, method: "POST", agent: false, headers: { "content-length": 14 } }, answer => {
      let text = "";
      answer.setEncoding("utf8").on("data", chunk => { text += chunk; }).on("end", () => resolve(text));
    });
    sent.on("error", error => resolve("the client: " + error.code));
    sent.flushHeaders();
    setTimeout(() => sent.end("a made-up body"), 8);
  });
for (let turn = 0; turn < turns; turn++) {
  const said = await send();
  if (said !== "drained 14") lines.push("a quiet request said " + said);
}
let heard = 0;
deed = request => {  };
lines.push("an heir with on: " + (await send()) + ", heard " + heard);
lines.push("asked " + asked);
lines.push("behind it: " + (await send()));
server.close();
server.closeAllConnections?.();
console.log(lines.join("\n"));
