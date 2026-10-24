// Each line asks for a built-in module that nothing imports. Its name is written in the program and comes to the loader, or the loader to the name, by a way that is no import by a constant name:
// a parameter, a property, a list, a binding that is stored to, `call`, `apply`, `bind`. The output is that of plain Bun.
import { createRequire } from "node:module";
import processOfNode from "node:process";
import { askElsewhere, heldElsewhere } from "./elsewhere.mjs";

function show(label, ask) {
  try {
    console.log(label, typeof ask());
  } catch (error) {
    console.log(label, error.name, error.code);
  }
}

function askHolder(holder) {
  return holder.getBuiltinModule("node:dgram").createSocket;
}
function askLoader(load) {
  return load("node:readline").createInterface;
}
function askByName(name) {
  return process.getBuiltinModule(name);
}
function askWithPrefix(name) {
  return process.getBuiltinModule("node:" + name);
}
class Holder {
  held = process;
  ask() {
    return this.held.getBuiltinModule("node:v8").getHeapStatistics;
  }
}
const { getBuiltinModule } = process;
const { process: destructured } = globalThis;
const table = { holder: process, name: "node:perf_hooks" };
const perhaps = typeof process !== "undefined" ? process : undefined;
let storedLater = null;
storedLater = process;
let made;
function requireLazily(name) {
  made ??= createRequire(import.meta.url);
  return made(name);
}
const meta = import.meta;

show("a parameter holds process", () => askHolder(process));
show("a parameter holds the function", () => askLoader(process.getBuiltinModule));
show("a parameter holds the name", () => askByName("node:vm").runInNewContext);
show("a parameter holds the rest of the name", () => askWithPrefix("querystring").parse);
show("a field holds process", () => new Holder().ask());
show("the function is destructured", () => getBuiltinModule("node:zlib").gzipSync);
show("process is destructured", () => destructured.getBuiltinModule("node:string_decoder").StringDecoder);
show("a property holds process", () => table.holder.getBuiltinModule("node:diagnostics_channel").channel);
show("a property holds the name", () => process.getBuiltinModule(table.name).performance);
show("an element holds process", () => [process][0].getBuiltinModule("node:punycode").toASCII);
show("one arm of a choice holds process", () => perhaps?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage);
show("a binding that is stored to holds process", () => storedLater.getBuiltinModule("node:os").cpus);
show("call", () => process.getBuiltinModule.call(process, "node:dns").lookup);
show("apply", () => process.getBuiltinModule.apply(process, ["node:tls"]).connect);
show("bind", () => process.getBuiltinModule.bind(process)("node:worker_threads").Worker);
show("Reflect.apply", () => Reflect.apply(process.getBuiltinModule, process, ["node:child_process"]).spawn);
show("the default export of node:process", () => processOfNode.getBuiltinModule("node:http2").connect);
show("self", () => self.process.getBuiltinModule("node:domain").create);
show("a function returns process", () => (() => process)().getBuiltinModule("node:trace_events").createTracing);
show("another file holds process", () => heldElsewhere.getBuiltinModule("node:wasi").WASI);
show("another file has the call", () => askElsewhere("node:inspector").Session);
show("a require that is made at the first call", () => requireLazily("node:cluster").fork);
show("a constant holds import.meta", () => meta.require("node:repl").start);
for (const name of ["node:assert", "timers/promises"])
  show("a list holds " + name, () => process.getBuiltinModule(name));
show("import() of a parameter", () => (name => import(name))("node:sqlite").then);
console.log(
  "import() of a parameter answers",
  typeof (await (name => import(name))("node:readline/promises")).createInterface,
);
show("no such module", () => askByName("node:no-such-module"));
