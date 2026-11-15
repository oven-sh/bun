// _isLenientHeaderValidation of a server's response is replaced in three places or nowhere, and the headers are set in six ways, three times each. Each call of the replacement is printed.
import http, { OutgoingMessage, ServerResponse } from "node:http";
import { listen } from "../../../js/node/http/probes/probe.ts";
import { RawHttpConnection, get } from "../../../js/node/http/raw-http-client.ts";

type Lenient = { _isLenientHeaderValidation(): boolean };

let lines: string[] = [];

function replace(holder: object) {
  const original = (OutgoingMessage.prototype as unknown as Lenient)._isLenientHeaderValidation;
  const own = Object.getOwnPropertyDescriptor(holder, "_isLenientHeaderValidation");
  Object.defineProperty(holder, "_isLenientHeaderValidation", {
    configurable: true,
    writable: true,
    value(this: Lenient) {
      lines.push("_isLenientHeaderValidation()");
      return original.call(this);
    },
  });
  return () => {
    if (own) Object.defineProperty(holder, "_isLenientHeaderValidation", own);
    else delete (holder as Partial<Lenient>)._isLenientHeaderValidation;
  };
}

const places: Record<string, (res: ServerResponse) => object | undefined> = {
  "nowhere": () => undefined,
  "on the response": res => res,
  "on ServerResponse.prototype": () => ServerResponse.prototype,
  "on OutgoingMessage.prototype": () => OutgoingMessage.prototype,
};

const ways: Record<string, (res: ServerResponse) => void> = {
  "setHeader() of a string, a number and a list": res => {
    res.setHeader("x-a", "1");
    res.setHeader("X-B", 2);
    res.setHeader("x-c", ["3", "4"]);
    res.end("ok");
  },
  "setHeader() of one name twice": res => {
    res.setHeader("x-a", "1");
    res.setHeader("X-A", "2");
    res.end("ok");
  },
  "writeHead() with an object": res => {
    res.writeHead(200, { "x-a": "1", "X-B": 2, "x-c": ["3", "4"] });
    res.end("ok");
  },
  "setHeader(), then writeHead() with an object": res => {
    res.setHeader("x-a", "1");
    res.writeHead(200, { "x-a": "5", "content-length": 2 });
    res.write("ok");
    res.end();
  },
  "setHeader(), then appendHeader()": res => {
    res.setHeader("x-a", "1");
    res.appendHeader("x-a", "2");
    res.end("ok");
  },
  "setHeader() of what is refused": res => {
    for (const [name, value] of [
      ["a b", "1"],
      ["x-a", undefined],
      ["x-a", "\n"],
      ["x-a", "Ā"],
    ] as [string, string][]) {
      try {
        res.setHeader(name, value);
      } catch (error) {
        lines.push("threw " + (error as { code?: string }).code);
      }
    }
    res.end("ok");
  },
};

let respond: (res: ServerResponse) => void;

const server = http.createServer((req, res) => respond(res));
using client = await RawHttpConnection.connect(await listen(server));

for (const [placeName, holderOf] of Object.entries(places)) {
  for (const [wayName, setHeaders] of Object.entries(ways)) {
    lines = [];
    for (let i = 0; i < 3; i++) {
      respond = res => {
        const holder = holderOf(res);
        const restore = holder && replace(holder);
        try {
          setHeaders(res);
        } finally {
          restore?.();
        }
      };
      lines.push(JSON.stringify(await client.request(get("/"))));
    }
    console.log(`replaced ${placeName}, ${wayName}:`);
    for (const line of lines) console.log("    " + line);
  }
}
server.close();
server.closeAllConnections();
