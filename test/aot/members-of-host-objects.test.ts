import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const lines = readFileSync(join(import.meta.dir, "../../src/sema/driver/members-of-host-objects.txt"), "utf8").trimEnd().split("\n");
const membersOf = (host: string) => lines.map(line => line.trimEnd().split(" ")).find(words => words[0] === host)!.slice(1);

// What the compiler takes for a member of process is found before EventEmitter.prototype, which a program can write.
test("every member of process is found on process or on the native prototype in front of EventEmitter.prototype", () => {
  const emitters = require("node:events").prototype;
  const native = Object.getPrototypeOf(process);
  expect(Object.getPrototypeOf(native)).toBe(emitters);
  const isFoundFirst = (name: string) => Object.hasOwn(process, name) || Object.hasOwn(native, name);
  expect(membersOf("process").filter(name => !isFoundFirst(name))).toEqual([]);
  expect(membersOf("process-not-on-windows").filter(name => !isFoundFirst(name))).toEqual(isWindows ? membersOf("process-not-on-windows") : []);
  expect(membersOf("process").length).toBeGreaterThan(80);
});

// Performance.prototype is reached through `Performance` or `performance` alone; EventTarget.prototype from any event target.
test("every member of performance is found before EventTarget.prototype", () => {
  expect(Object.getPrototypeOf(performance)).toBe(Performance.prototype);
  expect(Object.getPrototypeOf(Performance.prototype)).toBe(EventTarget.prototype);
  expect(membersOf("performance").filter(name => !Object.hasOwn(performance, name) && !Object.hasOwn(Performance.prototype, name))).toEqual([]);
});

test("nothing that a program can write lies above Bun and the global object", () => {
  expect(Object.getPrototypeOf(Bun)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(globalThis)).toBe(Object.prototype);
});

// A function that a program stores under one of these names may be called by native code with the object as its receiver.
test("every function that Bun, console, the global object, performance and process have or inherit is listed", () => {
  const script = `
    require("node:events");
    const found = {};
    for (const [host, object] of Object.entries({ Bun, console, global: globalThis, performance, process })) {
      const names = new Set();
      for (let holder = object; holder; holder = Object.getPrototypeOf(holder)) for (const key of Reflect.ownKeys(holder)) if (typeof key === "string") names.add(key);
      found[host] = [...names].filter(name => typeof object[name] === "function");
    }
    console.log(JSON.stringify(found));
  `;
  using dir = tempDir("members-of-host-objects", { "list.cjs": script });
  const ran = Bun.spawnSync({ cmd: [bunExe(), "list.cjs"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "inherit" });
  const found: Record<string, string[]> = JSON.parse(ran.stdout.toString());
  for (const [host, functions] of Object.entries(found)) {
    const listed = new Set(membersOf("functions-of-" + host));
    expect({ host, missing: functions.filter(name => !listed.has(name)) }).toEqual({ host, missing: [] });
  }
});

// The first argument of these constructors is the type of the event, which sits in a native slot.
test("the listed classes of events are all that the global object has, and each takes its type first", () => {
  const found = Object.getOwnPropertyNames(globalThis).filter(name => {
    const value = (globalThis as any)[name];
    return typeof value === "function" && (value === Event || value.prototype instanceof Event);
  });
  expect(found.sort()).toEqual(membersOf("classes-of-events"));
  expect(found.map(name => new (globalThis as any)[name]("mine", {}).type)).toEqual(found.map(() => "mine"));
});

// What is dispatched there without the program's asking: a listener for one of these types always counts.
test("native code dispatches on the global object only in a worker: message, messageerror, error", () => {
  const bindings = join(import.meta.dir, "../../src/jsc/bindings");
  const places = [...new Bun.Glob("**/*.{cpp,h}").scanSync(bindings)]
    .flatMap(file => readFileSync(join(bindings, file), "utf8").split("\n").filter(line => /globalEventScope(->|\.)dispatchEvent|eventTarget\(\)\.dispatchEvent/.test(line)).map(line => file + ": " + line.trim()))
    .sort();
  expect(places).toEqual([
    "webcore/Worker.cpp: globalObject->globalEventScope->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));",
    "webcore/WorkerMessagingProxy.cpp: globalObject.globalEventScope->dispatchEvent(event);",
  ]);
});

// A free name in this list is taken for what the runtime made.
test("every listed member of the global object is one", () => {
  expect(membersOf("global").filter(name => !Object.hasOwn(globalThis, name))).toEqual([]);
});
