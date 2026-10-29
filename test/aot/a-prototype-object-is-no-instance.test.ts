import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../src/js");

function prototypesTypedAsInstances(file: string, text: string) {
  const found: string[] = [];
  const onOneLine = text.replace(/\(\s+this:/g, "(this:");
  for (const [, name, type] of text.matchAll(/\b(\w+)\.prototype = \{\} as ([$\w.]+)/g)) {
    const receiver = `function ${name}(this: ${type}`;
    const at = onOneLine.indexOf(receiver);
    if (at !== -1 && !/[\w.$]/.test(onOneLine[at + receiver.length])) {
      found.push(`${file}: ${name}.prototype = {} as ${type}`);
    }
  }
  return found;
}

// An object literal takes the layout of the type it is cast to. A prototype object that has the fields of an instance,
// all of them empty, has to be asked at every read of a field that the instance itself does not have yet.
test("no prototype object of a constructor function is typed as an instance", () => {
  const found: string[] = [];
  for (const file of new Glob("**/*.ts").scanSync(root)) {
    found.push(...prototypesTypedAsInstances(file, readFileSync(join(root, file), "utf8")));
  }
  expect(found).toEqual([]);
});

test("a prototype object that is typed as an instance is found", () => {
  const text = `function Emitter(this: $Node.Emitter) {}\nEmitter.prototype = {} as $Node.Emitter;\n`;
  expect(prototypesTypedAsInstances("emitter.ts", text)).toEqual([
    "emitter.ts: Emitter.prototype = {} as $Node.Emitter",
  ]);
  expect(
    prototypesTypedAsInstances("emitter.ts", text.replace("as $Node.Emitter;", "as $Node.EmitterPrototype;")),
  ).toEqual([]);
});
