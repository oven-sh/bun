import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
