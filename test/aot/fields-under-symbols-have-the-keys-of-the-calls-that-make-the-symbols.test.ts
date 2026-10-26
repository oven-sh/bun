// The compiler knows the symbol of `const key = Symbol("key")` by the call that makes it: the module and the position of the call.
// The front end writes that key where a class or a type declares a field under the symbol, and the engine reads it off the call.
// Both have to say the same in every kind of text: a file of the program, a file that `bun build` wrote, which runs as it is
// written, and a module of the library, whose positions are those of the text that `bun run` evaluates.
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
  position: string;
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
      for (const [, description, id, position] of line.matchAll(/key=symbol\((?:"([^"]*)")?\)@(m\d+):(\d+)/g))
        declared.set(`${id}:${position}`, { description, module: id, position });
    } else if (line.startsWith("function ")) module = / module=(m\d+)/.exec(line)?.[1] ?? "";
    else {
      const call = / = Call .* calleeName="Symbol" @(\d+)/.exec(line);
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

describe("a field that is declared under a symbol", () => {
  test("has the key of the call that makes the symbol", async () => {
    using dir = tempDir("aot-fields-under-symbols", files);
    const folder = String(dir);
    built(
      await spawned([bunExe(), ...compileCommand, writesProgramInto(folder), "main.ts", "--outfile", "main"], folder, {
        ...bunEnv,
        NO_COLOR: "1",
      }),
    );
    const { keys, withoutCall } = readKeys(await printIR(folder, {}));
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
});
