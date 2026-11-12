// How often an own accessor laid over a field of one request is read and stored into, by the way the handler takes the body. Sixty quiet requests go in front, one behind.
import http from "node:http";
const names = ["_readableState", "_events", "socket", "_consuming", "_dumped", "complete", "upgrade"];
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
};
let way = "for await";
let deed = null;
const server = http.createServer((request, response) => {
  const tampering = deed;
  deed = null;
  tampering?.(request);
  return ways[way](request, response);
});
await new Promise(resolve => server.listen(0, resolve));
const send = async method =>
  (await fetch("http://127.0.0.1:" + server.address().port + "/", method === "GET" ? {} : { method, body: "a made-up body" })).text();
for (way in ways) {
  for (const method of ["POST", "GET"]) {
    for (let turn = 0; turn < 20; turn++) await send(method);
    for (const name of names) {
      let reads = 0;
      let stores = 0;
      deed = request => {
        let held = request[name];
        Object.defineProperty(request, name, {
          get() {
            reads++;
            return held;
          },
          set(value) {
            stores++;
            held = value;
          },
          configurable: true,
        });
      };
      const said = await send(method);
      await new Promise(resolve => setTimeout(resolve, 5));
      console.log(`${way}, ${method}, ${name}: ${said} . read ${reads} . stored ${stores} . behind it ${await send(method)}`);
    }
  }
}
server.close();
server.closeAllConnections?.();
