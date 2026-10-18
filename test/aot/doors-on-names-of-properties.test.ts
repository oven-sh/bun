import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const doors = readFileSync(join(import.meta.dir, "../../scripts/build/islands.doors"), "utf8");
const waiting = Array.from(doors.matchAll(/^when (\S+) property (\S+)$/gm), line => ({ feature: line[1], name: line[2] })).filter(line => line.name !== "*");
const names = [...new Set(waiting.map(line => line.name))];

function builtIns(): object[] {
  const seen = new Set<object>([globalThis]);
  for (const holder of seen) {
    for (const key of Reflect.ownKeys(holder)) {
      const value = Reflect.getOwnPropertyDescriptor(holder, key)?.value;
      if (value !== null && (typeof value === "object" || typeof value === "function")) seen.add(value);
    }
    const parent = Reflect.getPrototypeOf(holder);
    if (parent) seen.add(parent);
  }
  return [...seen];
}

test("parts of the runtime wait for names of properties", () => {
  expect(names.length).toBeGreaterThan(50);
});

test("every such name is an identifier: a key that holds any other character is none of them", () => {
  expect(names.filter(name => !/^[A-Za-z_$][\w$]*$/.test(name))).toEqual([]);
});

test("of the names of Object.prototype's members: the four that are named wherever a key is read, and toLocaleString, whose part is not Object.prototype's", () => {
  const inherited = Object.getOwnPropertyNames(Object.prototype);
  expect(names.filter(name => inherited.includes(name)).sort()).toEqual(["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "toLocaleString"]);
});

test("none is what turns an object into a primitive or a text: an operator calls none of them", () => {
  expect(names.filter(name => ["valueOf", "toString", "toJSON"].includes(name))).toEqual([]);
});

test("every part that waits for an option of Bun.serve also waits for reload, which may be handed any; but the bundler, which reload never starts", () => {
  const features = new Set(Array.from(doors.matchAll(/^when (\S+) serve-option \S+$/gm), line => line[1]));
  expect(features.size).toBeGreaterThan(4);
  expect([...features].filter(feature => feature !== "bundler" && !doors.includes(`\nwhen ${feature} reload-option *\n`))).toEqual([]);
  expect(doors).not.toContain("\nwhen bundler reload-option");
});

test("each is a method, which a read does not run; an accessor also waits for what makes its receiver", () => {
  const holders = builtIns();
  const isMethod = (name: string) => holders.some(holder => typeof Reflect.getOwnPropertyDescriptor(holder, name)?.value === "function");
  const accessors = waiting.filter(line => !isMethod(line.name));
  expect(accessors).toEqual([{ feature: "cookie", name: "cookies" }]);
  expect(accessors.filter(line => !doors.includes(`\nwhen ${line.feature} serve-option routes\n`))).toEqual([]);
});
