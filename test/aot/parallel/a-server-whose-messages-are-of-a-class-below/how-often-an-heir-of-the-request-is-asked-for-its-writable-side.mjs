// The requests of a server are of a class below the library's that declares getters under `_writableState` and `writable`. How often each is read, by the way the handler takes the body.
import http from "node:http";
let state = 0;
let side = 0;
class Asked extends http.IncomingMessage {
  get _writableState() {
    state++;
    return undefined;
  }
  get writable() {
    side++;
    return false;
  }
}
const ways = {
  "for await": async (request, response) => {
    let seen = 0;
    for await (const chunk of request) seen += chunk.length;
    response.end("took " + seen);
  },
  "a listener for data": (request, response) => {
    let seen = 0;
    request.on("data", chunk => (seen += chunk.length));
    request.on("end", () => response.end("took " + seen));
  },
  "nobody reads": (request, response) => void response.end("took nothing"),
  "resumed": (request, response) => void request.resume().on("end", () => response.end("took it")),
};
let way = "for await";
const server = http.createServer({ IncomingMessage: Asked }, (request, response) => ways[way](request, response));
await new Promise(resolve => server.listen(0, resolve));
const send = (method, late) =>
  new Promise(resolve => {
    const sent = http.request(
      { port: server.address().port, method, agent: false, headers: method === "POST" ? { "content-length": 14 } : {} },
      answer => {
        let text = "";
        answer
          .setEncoding("utf8")
          .on("data", chunk => {
            text += chunk;
          })
          .on("end", () => resolve(text));
      },
    );
    if (method !== "POST") return void sent.end();
    if (!late) return void sent.end("a made-up body");
    sent.flushHeaders();
    setTimeout(() => sent.end("a made-up body"), 8);
  });
for (way in ways) {
  for (const [method, late] of [
    ["POST", true],
    ["POST", false],
    ["GET", false],
  ]) {
    // Where nobody waits for the body, an answer races a body that comes late.
    if (late && way === "nobody reads") continue;
    for (const requests of [1, 3]) {
      state = side = 0;
      let said;
      for (let turn = 0; turn < requests; turn++) said = await send(method, late);
      await new Promise(resolve => setTimeout(resolve, 40));
      console.log(`${way}, ${method}${late ? " with a late body" : ""}, ${requests}: ${said} . _writableState ${state} . writable ${side}`);
    }
  }
}
server.close();
server.closeAllConnections?.();
