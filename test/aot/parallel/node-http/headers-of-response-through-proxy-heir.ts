// The headers of a response are stored, read, removed and sent through a Proxy that lists its traps and through an heir, behind headers that were stored on the response itself and without them.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Outgoing = http.ServerResponse & { getRawHeaderNames(): string[] };

function listing(response: Outgoing, trapped: string[]): Outgoing {
  return new Proxy(response, {
    get(target, key, receiver) {
      trapped.push(`get ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      trapped.push(`set ${String(key)}`);
      return Reflect.set(target, key, value, receiver);
    },
    has(target, key) {
      trapped.push(`has ${String(key)}`);
      return Reflect.has(target, key);
    },
    deleteProperty(target, key) {
      trapped.push(`delete ${String(key)}`);
      return Reflect.deleteProperty(target, key);
    },
  });
}

const before: Record<string, (response: Outgoing) => void> = {
  "nothing": () => {},
  "one header": response => void response.setHeader("x-first", "1"),
  "two headers": response => void response.setHeader("x-first", "1").setHeader("Content-Type", "text/plain"),
  "a header that was removed": response => {
    response.setHeader("x-first", "1");
    response.removeHeader("x-first");
  },
  "a list": response => void response.setHeader("x-first", ["1", "2"]),
};

const through: Record<string, (other: Outgoing) => unknown> = {
  "setHeader": other => void other.setHeader("x-a", "1"),
  "setHeader twice": other => void other.setHeader("x-a", "1").setHeader("x-a", "2"),
  "setHeader of the first": other => void other.setHeader("X-First", "3"),
  "setHeaders": other => void other.setHeaders(new Map([["x-a", "1"]])),
  "appendHeader": other => void other.appendHeader("x-a", "1"),
  "appendHeader to the first": other => void other.appendHeader("x-first", "3"),
  "removeHeader": other => other.removeHeader("x-first"),
  "getHeader": other => other.getHeader("x-first"),
  "hasHeader": other => other.hasHeader("x-first"),
  "getHeaders": other => JSON.stringify(other.getHeaders()),
  "getHeaderNames": other => other.getHeaderNames().join(),
  "getRawHeaderNames": other => other.getRawHeaderNames().join(),
  "writeHead": other => void other.writeHead(201),
  "writeHead with headers": other => void other.writeHead(201, { "x-a": "1" }),
  "writeHead with a list": other => void other.writeHead(201, ["x-a", "1"]),
  "flushHeaders": other => other.flushHeaders(),
  "write": other => other.write("a"),
  "nothing": () => {},
};

const turns: [string, string, string][] = [];
for (const kind of ["proxy", "heir"]) {
  for (const first in before) {
    for (const second in through) turns.push([kind, first, second]);
  }
}

let turn = 0;
const server = http.createServer((_request, made) => {
  const response = made as Outgoing;
  const [kind, first, second] = turns[turn++];
  const trapped: string[] = [];
  const other: Outgoing = kind === "proxy" ? listing(response, trapped) : Object.create(response);
  before[first](response);
  let answer: unknown;
  try {
    answer = through[second](other);
    other.end("b");
  } catch (error) {
    answer = `${(error as Error).name}: ${(error as Error).message}`;
    response.end("c");
  }
  console.log(
    `${kind} | ${first} | ${second}:`,
    answer,
    JSON.stringify(response.getHeaders()),
    Reflect.ownKeys(other).length,
  );
  if (trapped.length) console.log(" ", trapped.join(", "));
});
await once(server.listen(0, "127.0.0.1"), "listening");
const { port } = server.address() as AddressInfo;
for (let i = 0; i < turns.length; i++) {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const headers = [...response.headers].filter(([name]) => name !== "date").map(([name, value]) => `${name}=${value}`);
  console.log(" ", response.status, headers.join(" "), JSON.stringify(await response.text()));
}
server.close();
