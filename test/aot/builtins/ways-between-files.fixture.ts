// Two files of one test run call this: ways.test.ts. The first call writes down what every member holds that the table says stays as it is
// until the program writes it, the second prints which of them hold something else by then.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { describe } from "bun:jsc";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DumpedEntry, TableDump } from "../../../src/codegen/builtins/dump.ts";

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

// An object by the address of its cell, which the collector never moves: the runner takes away what a file leaves on an object.
function nameOf(value: unknown): string {
  if (isObject(value)) return /0x[0-9a-f]+/.exec(describe(value))?.[0] ?? "an object";
  return typeof value === "symbol" ? "a symbol" : `${typeof value} ${String(value)}`;
}

export function compareWithFirstFile() {
  const { entries }: TableDump = aotBuiltinEntries();
  const entryOf = new Map(entries.map(entry => [entry.token, entry]));
  const found = new Map<string, unknown>();

  function find(entry: DumpedEntry | undefined): unknown {
    if (!entry) return undefined;
    if (found.has(entry.token)) return found.get(entry.token);
    found.set(entry.token, undefined);
    let value: unknown;
    try {
      const holder = entry.holder ? find(entryOf.get(entry.holder)) : undefined;
      if (entry.token === "GlobalThis") value = globalThis;
      else if (/^(node|bun):[^.]*$/.test(entry.path)) value = require(entry.path);
      else if (isObject(holder)) {
        const key = entry.isSymbolName ? (Reflect.get(Symbol, entry.name) ?? Symbol.for(entry.name)) : entry.name;
        if (entry.isAddedAtFirstRead) Reflect.get(holder, key);
        value = Object.getOwnPropertyDescriptor(holder, key)?.value;
      }
    } catch {}
    found.set(entry.token, value);
    return value;
  }

  const names = entries
    .filter(
      entry => entry.kind !== "NativeBinding" && entry.scope === "Realm" && entry.mutability !== "ChangesOnItsOwn",
    )
    .map(entry => [entry.path, nameOf(find(entry))]);
  const path = process.env.AOT_WAYS_FIRST_FILE!;
  if (!existsSync(path)) return writeFileSync(path, JSON.stringify(names));
  const before = new Map<string, string>(JSON.parse(readFileSync(path, "utf8")));
  const changed = names.flatMap(([member, name]) => (before.get(member) === name ? [] : [member]));
  // What hangs below a member that has changed has changed with it.
  const first = changed.filter(member => !changed.some(other => member.startsWith(`${other}.`)));
  console.log("ANSWER " + JSON.stringify({ changed: first, compared: names.length }));
}
