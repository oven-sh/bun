// A request, a response or their socket is frozen, sealed or closed to new properties before, during or after an exchange, and the connection goes on.
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

process.on("uncaughtException", error => say("nobody caught", (error as Error)?.name, (error as Error)?.message));

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
/* Output:
== freeze request before
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze request before closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
request 1 error TypeError Attempted to assign to readonly property.
request 1 close 
response 1 close 
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== freeze request during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze request during closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
request 1 error TypeError Attempted to assign to readonly property.
request 1 close 
response 1 close 
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== freeze request after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze request after closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
request 1 error TypeError Attempted to assign to readonly property.
request 1 close 
response 1 close 
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== freeze response before
0: 200 0 first last
1: 200 null 
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze response before closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
request 1 end 
request 1 close 
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 2
socket close 
socket close, heard through an heir
== freeze response during
0: 200 0 first last
1: 200 1 first last
2: 200 null 
3: 200 2 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze response during closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
request 1 end 
request 1 close 
nobody caught Error ServerResponse has an already assigned socket
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
connections 2
socket close 
socket close, heard through an heir
== freeze response after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze response after closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempting to define property on object that is not extensible.
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== freeze socket before
0: 200 0 first last
1: 200 1 first last
2: 200 null 
3: 200 2 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze socket before closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
response 1 close 
request 1 end 
request 1 close 
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
connections 2
socket error TypeError Attempted to assign to readonly property.
socket close 
socket close, heard through an heir
socket close 
socket close, heard through an heir
== freeze socket during
0: 200 0 first last
1: 200 1 first last
2: 200 null 
3: 200 2 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze socket during closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
response 1 close 
request 1 end 
request 1 close 
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
connections 2
socket error TypeError Attempted to assign to readonly property.
socket close 
socket close, heard through an heir
socket close 
socket close, heard through an heir
== freeze socket after
0: 200 0 first last
1: 200 1 first last
2: 200 null 
3: 200 2 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
freeze socket after closed sealed frozen
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
response 1 close 
request 1 end 
request 1 close 
nobody caught TypeError Attempted to assign to readonly property.
nobody caught TypeError Attempted to assign to readonly property.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
connections 2
socket error TypeError Attempted to assign to readonly property.
socket close 
socket close, heard through an heir
socket close 
socket close, heard through an heir
== seal request before
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal request before closed sealed
response 1 finish 
response 1 close 
request 1 end 
nobody caught TypeError Attempting to define property on object that is not extensible.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal request during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal request during closed sealed
response 1 finish 
response 1 close 
request 1 end 
nobody caught TypeError Attempting to define property on object that is not extensible.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal request after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal request after closed sealed
response 1 finish 
response 1 close 
request 1 end 
nobody caught TypeError Attempting to define property on object that is not extensible.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal response before
0: 200 0 first last
1: TypeError
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal response before closed sealed
nobody caught TypeError Attempting to define property on object that is not extensible.
request 1 end 
request 1 close 
response 1 close 
socket close 
socket close, heard through an heir
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 2
socket close 
socket close, heard through an heir
== seal response during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal response during closed sealed
nobody caught TypeError Attempting to define property on object that is not extensible.
nobody caught TypeError Attempting to define property on object that is not extensible.
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal response after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal response after closed sealed
nobody caught TypeError Attempting to define property on object that is not extensible.
nobody caught TypeError Attempting to define property on object that is not extensible.
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal socket before
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal socket before closed sealed
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal socket during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal socket during closed sealed
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== seal socket after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
seal socket after closed sealed
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions request before
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions request before closed
response 1 finish 
response 1 close 
request 1 end 
nobody caught TypeError Attempting to define property on object that is not extensible.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions request during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions request during closed
response 1 finish 
response 1 close 
request 1 end 
nobody caught TypeError Attempting to define property on object that is not extensible.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions request after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions request after closed
response 1 finish 
response 1 close 
request 1 end 
nobody caught TypeError Attempting to define property on object that is not extensible.
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions response before
0: 200 0 first last
1: TypeError
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions response before closed
nobody caught TypeError Attempting to define property on object that is not extensible.
request 1 end 
request 1 close 
response 1 close 
socket close 
socket close, heard through an heir
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 2
socket close 
socket close, heard through an heir
== preventExtensions response during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions response during closed
nobody caught TypeError Attempting to define property on object that is not extensible.
nobody caught TypeError Attempting to define property on object that is not extensible.
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions response after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions response after closed
nobody caught TypeError Attempting to define property on object that is not extensible.
nobody caught TypeError Attempting to define property on object that is not extensible.
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions socket before
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions socket before closed
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions socket during
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions socket during closed
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
== preventExtensions socket after
0: 200 0 first last
1: 200 1 first last
2: 200 2 first last
3: 200 3 first last
response 0 finish 
response 0 close 
request 0 end 
request 0 close 
preventExtensions socket after closed
response 1 finish 
response 1 close 
request 1 end 
request 1 close 
response 2 finish 
response 2 close 
request 2 end 
request 2 close 
response 3 finish 
response 3 close 
request 3 end 
request 3 close 
connections 1
socket close 
socket close, heard through an heir
*/
