// `console.log(typeof map);` stopped the build: "internal compiler error (Load): the program enters functions of Bun's library that the load has left out: map of
// ArrayPrototype". A free name is a read off the global object. The engine took it for a name that is read off a value nobody knows and found it on every built-in
// that has a member of that name; the front end, which loads the library's code by the names of members, had not loaded it.
//
// Every name of a member that is written in the library's own code and is no name of a global, EACH IN A PROGRAM OF ITS OWN: the program is compiled as soon as a
// member of that name is read or written on anything, and beside much else.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const isFreeName = (name: string) => {
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || name in globalThis) return false;
  try {
    new Function(`"use strict"; return typeof ${name};`);
    return true;
  } catch {
    return false;
  }
};
const names = [
  ...new Set(
    aotBuiltinEntries()
      .entries.filter(
        ({ scope, holder, isSymbolName, overloads }) =>
          scope === "Realm" &&
          holder !== null &&
          !isSymbolName &&
          overloads.some(({ implementation: { how, otherwise } }) => how === "Compiled" || otherwise === "Compiled"),
      )
      .map(({ name }) => name)
      .filter(isFreeName),
  ),
].sort();

test("many members are written in the library's own code", () => {
  expect(names.length).toBeGreaterThan(50);
  expect(names).toEqual(expect.arrayContaining(["apply", "at", "call", "find", "map", "toSorted"]));
});

test.concurrent.each(names)(
  "asked for its type, read and called: %s",
  async name => {
    using dir = tempDir("aot-a-free-name", {
      "main.js": `console.log(typeof ${name});\ntry { console.log(${name}); } catch (error) { console.log(error.name); }\ntry { ${name}(1); } catch (error) { console.log(error.name); }\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "--no-pretty", "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ errors: (stdout + stderr).split("\n").filter(line => /\berror\b/.test(line)), exitCode }).toEqual({
      errors: [],
      exitCode: 0,
    });
  },
  600_000,
);
