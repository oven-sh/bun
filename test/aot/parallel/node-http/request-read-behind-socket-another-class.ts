// The listener of a node:http server puts an object of another class in req.socket and then reads the body in one of five ways. The object prints each read of readable and _paused and each call of resume() and pause().
import { EventEmitter } from "node:events";
import http, { type IncomingMessage } from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";
import { listen, nextTurn, untilDestroyed } from "../../../js/node/http/probes/probe.ts";
import { RawHttpConnection, post } from "../../../js/node/http/raw-http-client.ts";

let lines: string[] = [];

function record<T extends object>(object: T, isReadable: boolean, isPaused: boolean): T {
  return Object.defineProperties(object, {
    readable: {
      configurable: true,
      get() {
        lines.push("get readable");
        return isReadable;
      },
    },
    _paused: {
      configurable: true,
      get() {
        lines.push("get _paused");
        return isPaused;
      },
    },
    resume: {
      configurable: true,
      value() {
        lines.push("resume()");
        return this;
      },
    },
    pause: {
      configurable: true,
      value() {
        lines.push("pause()");
        return this;
      },
    },
  });
}

const objects: Record<string, () => object> = {
  "an object literal": () => ({}),
  "an object without a prototype": () => Object.create(null),
  "an EventEmitter": () => new EventEmitter(),
  "a Duplex": () => new Duplex({ read() {}, write() {} }),
  "a net.Socket that is not connected": () => new net.Socket(),
};

const readers: Record<string, (req: IncomingMessage, done: () => void) => void> = {
  "on('data')": (req, done) => void req.on("data", () => {}).on("end", done),
  "resume()": (req, done) => void req.on("end", done).resume(),
  "read() when readable": (req, done) => void req.on("readable", () => void req.read()).on("end", done),
  "for await": async (req, done) => {
    for await (const _ of req);
    done();
  },
  "not at all": (req, done) => done(),
};

const states: [string, boolean, boolean][] = [
  ["readable", true, false],
  ["not readable", false, false],
  ["readable and paused", true, true],
];

let prepare: (req: IncomingMessage, done: () => void) => void;
let connection: net.Socket | undefined;

process.on("uncaughtException", error => void lines.push(`uncaught ${error.name}`));

const server = http.createServer((req, res) => {
  prepare(req, () => {
    lines.push("the body has ended");
    res.end("ok");
  });
});

const port = await listen(server);

for (const [objectName, create] of Object.entries(objects)) {
  for (const [readerName, read] of Object.entries(readers)) {
    for (const [stateName, isReadable, isPaused] of states) {
      lines = [];
      prepare = (req, done) => {
        connection = req.socket;
        req.socket = record(create(), isReadable, isPaused) as net.Socket;
        read(req, done);
      };
      {
        using client = await RawHttpConnection.connect(port);
        for (let i = 0; i < 2; i++) {
          lines.push(`request ${i + 1}`);
          const answer = await client.request(post("/", "hello"));
          lines.push("answered " + answer.split("\r\n")[0]);
          await nextTurn();
          if (answer.startsWith("closed")) break;
        }
      }
      await untilDestroyed(connection);
      console.log(`${objectName}, ${stateName}, ${readerName}:`);
      for (const line of lines) console.log("    " + line);
    }
  }
}
server.close();
server.closeAllConnections();
