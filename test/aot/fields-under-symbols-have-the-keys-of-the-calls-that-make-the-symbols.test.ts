// The compiler knows the symbol of `const key = Symbol("key")` by the call that makes it: the module, and which of the calls of the module it is.
// The front end writes that key where a class or a type declares a field under the symbol, and the number on the call, where the engine reads it.
// Both say the same in every kind of text: a file of the program, a file that `bun build` wrote, which runs as it is written, and a module of the library.
// Where the call stands in the text is no part of the key.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { compileCommand } from "./harness/flags";
import { describe, printIR, test, writesProgramInto } from "./harness/printed-ir";
import { built, spawned } from "./run-programs";

const files = {
  "main.ts": `
    import { createServer } from "node:http";
    import { Written } from "./written.mjs";
    const kOwn = Symbol("kOwn");
    class Own {
      [kOwn] = 1;
    }
    console.log(new Own()[kOwn], new Written().read(), typeof createServer);
  `,
  "written.mjs": `// @bun
    const kWritten = Symbol("kWritten");
    export class Written {
      [kWritten] = 2;
      read() {
        return this[kWritten];
      }
    }
  `,
};

interface Key {
  description: string;
  module: string;
  callNumber: string;
}

function readKeys(ir: string) {
  const declared = new Map<string, Key>();
  const made = new Set<string>();
  const paths = new Map<string, string>();
  let module = "";
  for (const line of ir.split("\n")) {
    if (line.startsWith("module ")) {
      const [, id, path] = /^module (m\d+) path="([^"]*)"/.exec(line)!;
      paths.set(id, path);
    } else if (line.startsWith("layout ")) {
      for (const [, description, id, callNumber] of line.matchAll(/key=symbol\((?:"([^"]*)")?\)@(m\d+):(\d+)/g))
        declared.set(`${id}:${callNumber}`, { description, module: id, callNumber });
    } else if (line.startsWith("function ")) module = / module=(m\d+)/.exec(line)?.[1] ?? "";
    else {
      const call = / = Call .* calleeName="Symbol" callNumber=(\d+)/.exec(line);
      if (call) made.add(`${module}:${call[1]}`);
    }
  }
  const keys = [...declared].map(([place, key]) => ({
    ...key,
    module: paths.get(key.module)!,
    isMade: made.has(place),
  }));
  return { keys, withoutCall: keys.filter(key => !key.isMade).map(key => `${key.description} of ${key.module}`) };
}

async function buildIn(folder: string) {
  built(
    await spawned([bunExe(), ...compileCommand, writesProgramInto(folder), "main.ts", "--outfile", "main"], folder, {
      ...bunEnv,
      NO_COLOR: "1",
    }),
  );
  return readKeys(await printIR(folder, {}));
}

describe("a field that is declared under a symbol", () => {
  test("has the key of the call that makes the symbol", async () => {
    using dir = tempDir("aot-fields-under-symbols", files);
    const folder = String(dir);
    const { keys, withoutCall } = await buildIn(folder);
    expect(withoutCall).toEqual([]);
    const descriptionsIn = (isWanted: (module: string) => boolean) =>
      keys.filter(key => isWanted(key.module)).map(key => key.description);
    expect(descriptionsIn(module => module.endsWith("main.ts"))).toEqual(["kOwn"]);
    expect(descriptionsIn(module => module.endsWith("written.mjs"))).toEqual(["kWritten"]);
    expect(descriptionsIn(module => module === "node:_http_server").length).toBeGreaterThan(5);
    expect(descriptionsIn(module => module.startsWith("internal:")).length).toBeGreaterThan(5);

    const run = await spawned(["./main"], folder, bunEnv);
    expect(run.stdout.trim()).toBe("1 2 function");
  }, 240_000);

  test("has the same key wherever the call stands in the text", async () => {
    const keysOfProgram = async (texts: Record<string, string>) => {
      using dir = tempDir("aot-fields-under-symbols", texts);
      const { keys } = await buildIn(String(dir));
      return keys
        .filter(key => /(main\.ts|written\.mjs)$/.test(key.module))
        .map(key => ({ ...key, module: key.module.split("/").at(-1) }));
    };
    const moved = Object.entries(files).map(([name, text]) => [name, text.replaceAll("\n", "\n\n  /* a comment */  ")]);
    const keys = await keysOfProgram(files);
    expect(keys.map(key => key.description)).toEqual(["kOwn", "kWritten"]);
    expect(await keysOfProgram(Object.fromEntries(moved))).toEqual(keys);
  }, 240_000);
});
