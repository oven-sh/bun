import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("no field of a request, a response or a connection of node:http is optional", () => {
  const text = readFileSync(join(import.meta.dir, "../../src/js/internal/http.ts"), "utf8");
  const found: string[] = [];
  const optional: string[] = [];
  for (const [, name, body] of text.matchAll(/^interface (EmitterFields|IncomingMessageFields|ServerResponseFields|Connection)\b[^{]*\{\n([\s\S]*?)^\}/gm)) {
    found.push(name);
    for (const line of body.split("\n")) if (/^\s*(\w+|\[\w+\])\?:/.test(line)) optional.push(name + ": " + line.trim());
  }
  expect({ found: found.sort(), optional }).toEqual({
    found: ["Connection", "EmitterFields", "IncomingMessageFields", "ServerResponseFields"],
    optional: [],
  });
});
