// The never-index list of an HTTP/2 header block is keyed by the symbol that node:http2 exports. No registry holds that symbol, a block sent with a list under it arrives with the names of the list, and a list under the registered symbol of the old text marks nothing.
import { once } from "node:events";
import { connect, createServer, sensitiveHeaders, type ClientHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";

const registered = Symbol.for("nodejs.http2.sensitiveHeaders");
console.log(
  typeof sensitiveHeaders,
  String(sensitiveHeaders),
  Symbol.keyFor(sensitiveHeaders),
  sensitiveHeaders === registered,
);

type Headers = Record<string | symbol, unknown>;
const own: Headers = { ":path": "/", "x-own": "1", [sensitiveHeaders]: ["x-own"] };
console.log(own[sensitiveHeaders], own[registered], Object.getOwnPropertySymbols(own).length);

function received(block: object) {
  const headers = block as Headers;
  return JSON.stringify({
    list: headers[sensitiveHeaders],
    symbols: Object.getOwnPropertySymbols(headers).length,
    underRegistered: headers[registered] === undefined ? "nothing" : headers[registered],
  });
}

const seen: Record<string, string> = {};
const server = createServer();
server.on("stream", (stream: any, headers) => {
  const path = headers[":path"] as string;
  seen["request " + path] = received(headers);
  stream.respond({
    ":status": 200,
    "x-response": "1",
    [path === "/export" ? sensitiveHeaders : registered]: ["x-response"],
  });
  stream.end();
});
await once(server.listen(0, "127.0.0.1"), "listening");
const client = connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

async function roundTrip(session: ClientHttp2Session, path: string, key: symbol) {
  const request = session.request({ ":path": path, "x-request": "1", [key]: ["x-request"] });
  request.on("response", headers => (seen["response " + path] = received(headers)));
  request.resume();
  await once(request, "end");
}
await Promise.all([roundTrip(client, "/export", sensitiveHeaders), roundTrip(client, "/registered", registered)]);
client.close();
server.close();

for (const name of ["request /export", "response /export", "request /registered", "response /registered"])
  console.log(name, seen[name]);
