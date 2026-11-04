// RUN: lower
// OPTIONS: builtin-modules

import { EventEmitter } from "node:events";
import { createServer, ServerResponse } from "node:http";
import type { IncomingMessage } from "node:http";
import { Stream } from "node:stream";

const lines: string[] = [];
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_req, res) => void res.end("plain");

const server = createServer((req, res) => handler(req, res));
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;

async function ask(title: string, how: Handler) {
  lines.push("-- " + title);
  handler = how;
  for (let i = 0; i < 3; i++) {
    const answer = await (await fetch(url + "/" + i)).text();
    for (let turns = 0; turns < 4; turns++) await turn();
    lines.push("answer: " + answer);
  }
}

const names = ["socket", "prefinish", "finish", "close"];

for (let i = 0; i < 200; i++) await (await fetch(url + "/warm")).text();
await turn();

await ask("nobody listens", (_req, res) => void res.end("quiet"));

await ask("a listener for every event", (_req, res) => {
  for (const name of names) res.on(name, () => lines.push("heard " + name));
  res.end("heard");
});

await ask("two listeners for close, one once", (_req, res) => {
  res.on("close", () => lines.push("close 1, closed " + res.closed + ", destroyed " + res.destroyed));
  res.once("close", () => lines.push("close 2, listeners " + res.listenerCount("close")));
  res.end("twice");
});

await ask("a listener added by a listener", (_req, res) => {
  res.on("prefinish", () => {
    lines.push("prefinish");
    res.on("finish", () => {
      lines.push("finish");
      res.on("close", () => lines.push("close"));
    });
  });
  res.end("chain");
});

await ask("emit replaced on the response", (_req, res) => {
  const original = res.emit;
  res.emit = function (this: ServerResponse, name: string | symbol, ...rest: unknown[]) {
    lines.push("own emit " + String(name) + " " + rest.length);
    return original.call(this, name, ...rest);
  } as typeof res.emit;
  res.end("own");
});

{
  const original = ServerResponse.prototype.emit;
  ServerResponse.prototype.emit = function (this: ServerResponse, name: string | symbol, ...rest: unknown[]) {
    lines.push("class emit " + String(name) + " " + rest.length);
    return original.call(this, name, ...rest);
  } as typeof original;
  await ask("emit replaced on ServerResponse.prototype", (_req, res) => void res.end("class"));
  ServerResponse.prototype.emit = original;
}

{
  const seen: string[] = [];
  const original = EventEmitter.prototype.emit;
  EventEmitter.prototype.emit = function (this: EventEmitter, name: string | symbol, ...rest: unknown[]) {
    if (this instanceof ServerResponse) seen.push(String(name));
    return original.call(this, name, ...rest);
  } as typeof original;
  await ask("emit replaced on EventEmitter.prototype", (_req, res) => void res.end("base"));
  EventEmitter.prototype.emit = original;
  lines.push("seen: " + seen.join());
}

{
  const seen: string[] = [];
  const prototype = Stream.prototype as unknown as { emit?: typeof EventEmitter.prototype.emit };
  prototype.emit = function (this: EventEmitter, name: string | symbol, ...rest: unknown[]) {
    if (this instanceof ServerResponse) seen.push(String(name));
    return EventEmitter.prototype.emit.call(this, name, ...rest);
  };
  await ask("emit defined on Stream.prototype", (_req, res) => void res.end("stream"));
  delete prototype.emit;
  lines.push("seen: " + seen.join());
}

await ask("nobody listens again", (_req, res) => void res.end("quiet"));

await ask("the events object replaced", (_req, res) => {
  const events = Object.create(null);
  events.close = () => lines.push("close from another events object");
  (res as unknown as { _events: unknown })._events = events;
  res.end("replaced");
});

await ask("written in pieces, ended late", (_req, res) => {
  res.on("close", () => lines.push("close, finished " + res.writableFinished));
  res.write("a");
  setImmediate(() => {
    res.write("b");
    res.end("c");
  });
});

await ask("destroyed before it ends", (_req, res) => {
  res.on("close", () => lines.push("close, finished " + res.writableFinished + ", destroyed " + res.destroyed));
  res.on("finish", () => lines.push("finish"));
  res.write("part");
  setImmediate(() => res.destroy());
}).catch(error => lines.push("the client: " + (error as Error).name));
await turn();
await turn();

server.close();
await turn();
console.log(lines.join("\n"));

// GENERATED: ask turn
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|[[f_1]]):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="lines"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string="-- "
// CHECK-NEXT: v7 = Add v6, v1
// CHECK-NEXT: v8 = Call v5, v4, v7 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v9 = Convert v8 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="handler"
// CHECK-NEXT: v12 = Convert v2 declared={type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_3]]
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v15)
// CHECK-NEXT: b1(v16: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = Integer integer=3
// CHECK-NEXT: v19 = Less v16, v18
// CHECK-NEXT: Branch v19 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="fetch" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Fetch) flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="url"
// CHECK-NEXT: v25 = String string="/"
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = Add v26, v16
// CHECK-NEXT: v28 = Call v22, -, v27 calleeName="fetch"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Promise<undefined|null|Response> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v30 = Await v29, v1, v2
// CHECK-NEXT: v31 = PropGet v30 key="text"
// CHECK-NEXT: v32 = Call v31, v30 calleeKey="text" calleeName="text"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = Await v33, v1, v2
// CHECK-NEXT: v35 = Integer
// CHECK-NEXT: v36 = Convert v35 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v36)
// CHECK-NEXT: b3(v37: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v39 = Integer integer=4
// CHECK-NEXT: v40 = Less v37, v39
// CHECK-NEXT: Branch v40 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="turn"
// CHECK-NEXT: v43 = Call v42 calleeName="turn"
// CHECK-NEXT: v44 = Await v43, v1, v2
// CHECK-NEXT: v45 = Increment v37
// CHECK-NEXT: v46 = Convert v45 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v46)
// CHECK-NEXT: b5():
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v48 = CheckInitialized v47 name="lines"
// CHECK-NEXT: v49 = PropGet v48 key="push"
// CHECK-NEXT: v50 = String string="answer: "
// CHECK-NEXT: v51 = Add v50, v34
// CHECK-NEXT: v52 = Call v49, v48, v51 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v53 = Convert v52 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v54 = Increment v16
// CHECK-NEXT: v55 = Convert v54 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v55)
// CHECK-NEXT: b6():
// CHECK-NEXT: v56 = Undefined
// CHECK-NEXT: Return v56
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="turn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_6]]
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Promise"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
