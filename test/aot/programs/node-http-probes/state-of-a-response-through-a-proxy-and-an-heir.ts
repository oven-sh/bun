// A response is written, ended, destroyed and asked for its state through a Proxy that lists its traps and through an heir, alone and in turns with the response itself. Each turn prints what was trapped until the connection was free again, and the keys that the heir and the response have then.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Outgoing = http.ServerResponse & {
  _send(data: string, encoding?: string): void;
  _implicitHeader(): void;
  _callPendingCallbacks(): void;
};

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

const said: string[] = [];
const say = (text: string) => () => void said.push(text);

const turnsOf: Record<string, (other: Outgoing, response: Outgoing) => unknown> = {
  "end": other => void other.end("b"),
  "end without a chunk": other => void other.end(),
  "end with a callback": other => void other.end("b", say("ended")),
  "end twice": other => void other.end("b").end(),
  "write behind end": other => {
    other.on("error", error => said.push(error.message));
    other.end("b");
    return other.write("c");
  },
  "write with a callback": other => {
    const answer = other.write("a", say("written"));
    other.end("b");
    return answer;
  },
  "two writes": other => {
    const answer = [other.write("a"), other.write("b")];
    other.end();
    return answer;
  },
  "headersSent": other => {
    const answer = [other.headersSent];
    other.writeHead(202);
    answer.push(other.headersSent);
    other.end("b");
    answer.push(other.headersSent);
    return answer;
  },
  "socket": other => {
    const answer = other.socket === other.connection;
    other.end("b");
    return answer;
  },
  "what waits to be written": other => {
    const answer = [other.writableLength, other.writableNeedDrain, other.writableFinished];
    other.write("abc");
    answer.push(other.writableLength, other.writableNeedDrain, other.writableFinished);
    other.end("b");
    answer.push(other.writableLength, other.writableNeedDrain, other.writableFinished);
    return answer;
  },
  "a status without a body": other => {
    other.statusCode = 204;
    other.end("b");
  },
  "a connection that closes": other => {
    other.setHeader("Connection", "close");
    other.end("b");
  },
  "no content length": other => {
    other.removeHeader("content-length");
    other.end("b");
  },
  "a strict content length": other => {
    other.strictContentLength = true;
    other.setHeader("Content-Length", 1);
    other.end("b");
  },
  "_send": other => {
    other._send("1\r\na\r\n", "latin1");
    other.end();
  },
  "_implicitHeader": other => {
    other._implicitHeader();
    other.end("b");
  },
  "_callPendingCallbacks": other => {
    other._callPendingCallbacks();
    other.end("b");
  },
  "a writeHead of its own": other => {
    other.writeHead = function (this: Outgoing, ...parameters: any[]) {
      said.push("writeHead");
      return (http.ServerResponse.prototype.writeHead as any).apply(this, parameters);
    } as any;
    other.end("b");
  },
  "listeners": other => {
    other.on("prefinish", say("prefinish")).on("finish", say("finish")).on("close", say("close"));
    other.end("b");
  },
  "cork": other => {
    other.cork();
    other.write("a");
    other.uncork();
    other.end("b");
  },
  "destroy": other => void other.destroy(),
  "write, then the response ends": (other, response) => {
    other.write("a");
    response.end("b");
  },
  "the response writes, then end": (other, response) => {
    response.write("a");
    other.end("b");
  },
  "the response writes under a content length, then end": (other, response) => {
    response.setHeader("Content-Length", 2);
    response.write("a");
    other.end("b");
  },
  "the response writes the head, then end": (other, response) => {
    response.writeHead(201, { "x-a": "1" });
    other.end("b");
  },
  "writeHead, then the response ends": (other, response) => {
    other.writeHead(201, { "x-a": "1" });
    response.end("b");
  },
  "end, then the response ends": (other, response) => {
    response.on("error", error => said.push(error.message));
    other.end("b");
    response.end("c");
  },
  "the response ends, then end": (other, response) => {
    response.on("error", error => said.push(error.message));
    response.end("b");
    other.end("c");
  },
};

const turns: [string, string][] = [];
for (const kind of ["proxy", "heir"]) {
  for (const name in turnsOf) turns.push([kind, name]);
}

const keysOf = (object: object) => Reflect.ownKeys(object).map(String).join(" ");

let turn = 0;
let report = () => {};
let isClosed = () => true;
const server = http.createServer((_request, made) => {
  const response = made as Outgoing;
  const [kind, name] = turns[turn++];
  const trapped: string[] = [];
  const keysBefore = new Set(Reflect.ownKeys(response));
  const other: Outgoing = kind === "proxy" ? listing(response, trapped) : Object.create(response);
  said.length = 0;
  let answer: unknown;
  try {
    answer = turnsOf[name](other, response);
  } catch (error) {
    answer = `${(error as Error).name}: ${(error as Error).message}`;
    response.destroy();
  }
  console.log(`${kind} | ${name}:`, JSON.stringify(answer), response.headersSent, response.finished);
  isClosed = () => response.closed || (kind === "heir" && other.closed);
  report = () => {
    if (trapped.length) console.log(" ", trapped.join(", "));
    else console.log("  its own:", keysOf(other));
    console.log(
      "  new on the response:",
      Reflect.ownKeys(response)
        .filter(key => !keysBefore.has(key))
        .map(String)
        .join(" "),
    );
    console.log("  said:", said.join(", "), response.destroyed, response.writableEnded, other.destroyed, other.closed);
  };
});
await once(server.listen(0, "127.0.0.1"), "listening");
const { port } = server.address() as AddressInfo;
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
function ask(): Promise<string> {
  return new Promise(resolve => {
    http
      .get({ host: "127.0.0.1", port, agent }, response => {
        const headers = Object.entries(response.headers)
          .filter(([name]) => name !== "date")
          .map(([name, value]) => `${name}=${value}`);
        let body = "";
        response
          .setEncoding("latin1")
          .on("data", chunk => (body += chunk))
          .on("end", () => resolve(`${response.statusCode} ${headers.join(" ")} ${JSON.stringify(body)}`))
          .on("error", error => resolve((error as NodeJS.ErrnoException).code!));
      })
      .on("error", error => resolve((error as NodeJS.ErrnoException).code!));
  });
}
for (let i = 0; i < turns.length; i++) {
  console.log(" ", await ask());
  while (!isClosed()) await new Promise(resolve => setTimeout(resolve, 1));
  await new Promise(resolve => setImmediate(resolve));
  report();
}
agent.destroy();
server.close();
