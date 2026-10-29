// headersSent or hasHeader of a response is replaced. What writeHead() with an object of headers reads and calls is printed.
import { once } from "node:events";
import http, { type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

let seen: string[] = [];

function findDescriptor(holder: object, name: string): PropertyDescriptor {
  let owner = holder;
  while (!Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
  return Object.getOwnPropertyDescriptor(owner, name)!;
}

function replaceHeadersSent(holder: object) {
  const original = findDescriptor(holder, "headersSent");
  Object.defineProperty(holder, "headersSent", {
    configurable: true,
    get(this: ServerResponse) {
      seen.push("headersSent");
      return original.get!.call(this);
    },
  });
  return () => void delete (holder as any).headersSent;
}

function replaceHasHeader(holder: any) {
  const isOwn = Object.hasOwn(holder, "hasHeader");
  const original = holder.hasHeader;
  holder.hasHeader = function (this: ServerResponse, name: string) {
    seen.push(`hasHeader ${name}`);
    return original.call(this, name);
  };
  return () => void (isOwn ? (holder.hasHeader = original) : delete holder.hasHeader);
}

const replacements: Record<string, (res: ServerResponse) => () => void> = {
  "nothing": () => () => {},
  "headersSent on the response": res => replaceHeadersSent(res),
  "headersSent on an heir of ServerResponse.prototype": res => {
    const heir = Object.create(http.ServerResponse.prototype);
    Object.setPrototypeOf(res, heir);
    return replaceHeadersSent(heir);
  },
  "hasHeader on the response": res => replaceHasHeader(res),
  "hasHeader on ServerResponse.prototype": () => replaceHasHeader(http.ServerResponse.prototype),
  "hasHeader on OutgoingMessage.prototype": () => replaceHasHeader(http.OutgoingMessage.prototype),
};

const exchanges: Record<string, (res: ServerResponse) => void> = {
  "writeHead(object), end(body)": res => {
    res.writeHead(200, { "x-a": "1" });
    res.end("body");
  },
  "setHeader(), writeHead(object), write(), end()": res => {
    res.setHeader("x-b", "2");
    res.writeHead(200, { "x-a": "1" });
    res.write("bo");
    res.end("dy");
  },
  "writeHead(a content-length), end(body)": res => {
    res.writeHead(200, { "content-length": "4" });
    res.end("body");
  },
  "writeHead(a status alone), end(body)": res => {
    res.writeHead(201);
    res.end("body");
  },
  "writeHead() twice": res => {
    res.writeHead(200, { "x-a": "1" });
    try {
      res.writeHead(200, { "x-a": "2" });
    } catch (error) {
      seen.push((error as NodeJS.ErrnoException).code!);
    }
    res.end("body");
  },
  "end(body)": res => void res.end("body"),
};

let respond: (res: ServerResponse) => void;
const server = http.createServer((_req, res) => respond(res));
await once(server.listen(0, "127.0.0.1"), "listening");
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

for (const [what, replace] of Object.entries(replacements)) {
  for (const [how, answer] of Object.entries(exchanges)) {
    let restore = () => {};
    respond = res => {
      restore = replace(res);
      answer(res);
    };
    const response = await fetch(url);
    const body = await response.text();
    restore();
    const headers = ["x-a", "x-b", "content-length", "transfer-encoding"]
      .map(name => response.headers.get(name))
      .join(" ");
    console.log(`${what}, ${how}: ${response.status} ${body} ${headers} | ${seen.join(" | ")}`);
    seen = [];
  }
}
server.close();
server.closeAllConnections();
