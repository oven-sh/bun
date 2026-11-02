// RUN: lower
// OPTIONS: builtin-modules

// What is received from a port is used as a config.
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

interface Config {
  port: number;
  ratio: number;
  host: string;
  secure: boolean;
  paths: string[];
  limits: { max: number };
  note?: string;
}

function config(port: number): Config {
  return { port, ratio: 0.5, host: "localhost", secure: true, paths: ["/"], limits: { max: 10 } };
}

function received(source: Config): Config {
  const { port1, port2 } = new MessageChannel();
  port1.postMessage(source);
  const arrived = receiveMessageOnPort(port2);
  port1.close();
  port2.close();
  return arrived?.message;
}

const uses: [string, (c: Config) => unknown][] = [
  ["typeof", c => typeof c],
  ["port + 1", c => c.port + 1],
  ["ratio * 2", c => c.ratio * 2],
  ["port | 0", c => c.port | 0],
  ["length of the host", c => c.host.length],
  ["the host and the port", c => c.host + ":" + c.port],
  ["secure", c => (c.secure ? "yes" : "no")],
  ["exactly true", c => c.secure === true],
  ["paths", c => [c.paths.length, c.paths[0]]],
  ["the limit", c => c.limits.max + 1],
  ["note", c => c.note ?? "no note"],
  ["kinds", c => [typeof c.port, typeof c.ratio, typeof c.host, typeof c.secure, typeof c.paths, typeof c.limits, typeof c.note]],
  ["a store to the port", c => {
    c.port = 81.5;
    return [c.port, c.port + c.ratio];
  }],
  ["port++", c => {
    c.port++;
    return c.port;
  }],
  ["a store to the host", c => {
    c.host = "example";
    return c.host.length;
  }],
  ["a store to the note", c => {
    c.note = "noted";
    return [c.note, Object.keys(c)];
  }],
  ["delete the note", c => [delete c.note, "note" in c]],
  ["a pushed path", c => c.paths.push("/more")],
  ["a store to the limit", c => {
    c.limits.max = 20;
    return c.limits.max;
  }],
  ["in", c => ["port" in c, "note" in c, "missing" in c]],
  ["own", c => [Object.hasOwn(c, "port"), Object.hasOwn(c, "host")]],
  ["keys", c => Object.keys(c)],
  ["JSON", c => JSON.stringify(c)],
  ["for-in", c => {
    const names: string[] = [];
    for (const name in c) names.push(name);
    return names;
  }],
  ["a pattern", c => {
    const { port, host, limits: { max } } = c;
    return [port, host, max];
  }],
  ["a spread", c => ({ ...c, port: 1 })],
  ["prototype", c => Object.getPrototypeOf(c) === Object.prototype],
];

function address(c: Config): string {
  return c.host + ":" + c.port;
}

function budget(c: Config): number {
  return c.limits.max * c.ratio + c.port;
}

function move(c: Config, port: number): number {
  c.port = port;
  return c.port;
}

class Server {
  name = "server";
  config: Config;
  started = 0.5;
  constructor(config: Config) {
    this.config = config;
  }
  address(): string {
    return this.config.host + ":" + this.config.port;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = config(i);
  warm += address(honest).length + budget(honest) + move(honest, 1) + new Server(honest).address().length;
}
for (const [, use] of uses) for (let i = 0; i < 200; i++) use(config(i));
console.log("after the honest configs", warm);

for (const [name, use] of uses) {
  attempt(name, () => use(received(config(80))));
}
{
  const source = config(80);
  const made = received(source);
  attempt("typed functions", () => [address(made), budget(made), move(made, 8080)]);
  attempt("in a field", () => {
    const server = new Server(made);
    return [server.name, server.address(), server.started];
  });
  attempt("among honest configs", () => [config(1), made, config(2)].map(budget));
  attempt("is it the source", () => made === source);
  attempt("the source afterwards", () => [source.port, source.host, source.paths, Object.keys(source)]);
  attempt("a store to the source is seen", () => {
    source.port = 100;
    source.paths.push("/late");
    return [made.port, made.paths];
  });
}
attempt("honest again", () => [address(config(80)), budget(config(80)), move(config(80), 1)]);

export {};

// GENERATED: config received Server
// CHECK-LABEL: function {{*}}name="config"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = Double number=0.5
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = String string="localhost"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean}
// CHECK-NEXT: v8 = Data data=[[d_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Data data=[[d_5]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = NewObject -, v1, v3, v5, v7, v9, v11 layout=[[L_2]] fields=[4, 5, 0, 6, 3, 1]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="received"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="MessageChannel"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(NodeWorker_threadsMessageChannel) flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Construct v4 calleeName="MessageChannel"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="port1"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = PropGet v10 key="port1"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v10 key="port2"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v12 key="postMessage"
// CHECK-NEXT: v16 = Call v15, v12, v0 calleeKey="postMessage" calleeName="port1.postMessage"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="receiveMessageOnPort"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(NodeWorker_threadsReceiveMessageOnPort) flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v19, -, v14 calleeName="receiveMessageOnPort"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v12 key="close"
// CHECK-NEXT: v23 = Call v22, v12 calleeKey="close" calleeName="port1.close"
// CHECK-NEXT: v24 = PropGet v14 key="close"
// CHECK-NEXT: v25 = Call v24, v14 calleeKey="close" calleeName="port2.close"
// CHECK-NEXT: v26 = TypeTest v21 testedType=undefined|null
// CHECK-NEXT: Branch v26 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v27):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: v30 = PropGet v29 key="message"
// CHECK-NEXT: Jump -> next b8(v30)
// CHECK-NEXT: b8(v31):
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[L_2]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Server"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_16]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_16]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_17]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v6 key="config"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
