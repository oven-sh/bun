import { expect } from "bun:test";
import { test } from "./supported";

// What a member of process is found on comes before EventEmitter.prototype, which a program can write.
test("the native prototype of process stands in front of EventEmitter.prototype", () => {
  expect(Object.getPrototypeOf(Object.getPrototypeOf(process))).toBe(require("node:events").prototype);
});

// Performance.prototype is reached through `Performance` or `performance` alone; EventTarget.prototype from any event target.
test("Performance.prototype stands in front of EventTarget.prototype", () => {
  expect(Object.getPrototypeOf(performance)).toBe(Performance.prototype);
  expect(Object.getPrototypeOf(Performance.prototype)).toBe(EventTarget.prototype);
});

test("nothing that a program can write lies above Bun and the global object", () => {
  expect(Object.getPrototypeOf(Bun)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(globalThis)).toBe(Object.prototype);
});

// The first argument of these constructors is the type of the event, which sits in a native slot.
test("each class of events that the global object has takes its type first", () => {
  const found = Object.getOwnPropertyNames(globalThis).filter(name => {
    const value = (globalThis as any)[name];
    return typeof value === "function" && (value === Event || value.prototype instanceof Event);
  });
  expect(found).toContain("Event");
  expect(found.map(name => new (globalThis as any)[name]("mine", {}).type)).toEqual(found.map(() => "mine"));
});
