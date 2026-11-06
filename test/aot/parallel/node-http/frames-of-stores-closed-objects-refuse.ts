// A request, a response or their socket is frozen, sealed or closed to new properties before, during or after an exchange. Every error nobody catches is printed with the names of the functions in its stack trace.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

const levels = {
  freeze: (object: object) => void Object.freeze(object),
  seal: (object: object) => void Object.seal(object),
  preventExtensions: (object: object) => void Object.preventExtensions(object),
};
type Level = keyof typeof levels;
type Target = "request" | "response" | "socket";
type Moment = "before" | "during" | "after";

let lines: string[] = [];
const say = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));

// The names of the functions in a stack trace, without their places.
function frames(error: unknown) {
  return String((error as Error)?.stack)
    .split("\n")
    .slice(1)
    .map(line => {
      const text = line.trim().replace(/^at /, "");
      return text.includes(" (") ? text.slice(0, text.indexOf(" (")) : "";
    })
    .join(" < ");
}

process.on("uncaughtException", error =>
  say("nobody caught", (error as Error)?.name, (error as Error)?.message, "in", frames(error)),
);

function watch(label: string, emitter: NodeJS.EventEmitter, events: string[]) {
  for (const event of events) {
    emitter.on(event, (value?: unknown) =>
      say(label, event, value instanceof Error ? `${value.name} ${value.message}` : ""),
    );
  }
}

function describe(object: object) {
  return `${Object.isExtensible(object) ? "open" : "closed"}${Object.isSealed(object) ? " sealed" : ""}${Object.isFrozen(object) ? " frozen" : ""}`;
}

async function runCase(level: Level, target: Target, moment: Moment) {
  lines = [];
  const seen = new Set<Socket>();
  let turn = 0;
  const server = http.createServer((request, response) => {
    const socket = request.socket;
    if (!seen.has(socket)) {
      seen.add(socket);
      watch("socket", socket, ["close", "error", "end", "timeout"]);
      Object.create(socket).once("close", () => say("socket close, heard through an heir"));
    }
    const index = turn++;
    watch(`request ${index}`, request, ["close", "error", "end", "aborted"]);
    watch(`response ${index}`, response, ["close", "error", "finish"]);
    const chosen = { request, response, socket }[target];
    const close = () => {
      levels[level](chosen);
      say(level, target, moment, describe(chosen));
    };
    const isChosenTurn = index === 1;
    request.resume();
    if (isChosenTurn && moment === "before") close();
    response.setHeader("x-turn", String(index));
    response.write("first ");
    if (isChosenTurn && moment === "during") close();
    response.end("last");
    if (isChosenTurn && moment === "after") close();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  const answers: string[] = [];
  for (let index = 0; index < 4; index++) {
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/${index}`, {
        method: "POST",
        body: "body",
        signal: AbortSignal.timeout(20000),
      });
      answers.push(`${index}: ${answer.status} ${answer.headers.get("x-turn")} ${await answer.text()}`);
    } catch (error) {
      answers.push(`${index}: ${(error as Error)?.name}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  say("connections", seen.size);
  server.closeAllConnections();
  server.close();
  await new Promise(resolve => setTimeout(resolve, 10));
  console.log(`== ${level} ${target} ${moment}`);
  console.log(answers.join("\n"));
  console.log(lines.join("\n"));
}

for (const level of Object.keys(levels) as Level[]) {
  for (const target of ["request", "response", "socket"] as const) {
    for (const moment of ["before", "during", "after"] as const) await runCase(level, target, moment);
  }
}
