import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// `pirates`, and through it `@babel/register` and `sucrase/register`, stores a loader when it starts. An executable of `bun build --compile`
// stores it, hands it no file of its own, and hands it each file that it reads from disk as it runs.
const main = `
const Module = require("node:module");
const path = require("node:path");
const say = (...words) => console.log("SEEN " + words.join(" "));
const short = value => String(value).replace(/^.*[\\\\/]/, "");
const seen = [];
const original = Module._extensions[".js"];
const suffix = process.env.NO_SUCH_VARIABLE ?? "";
const outcomeOf = store => { try { store(); return "nothing thrown"; } catch (error) { return error.constructor.name; } };
const loader = function (module, filename) { seen.push(short(filename)); return original(module, filename); };
const fromDisk = name => { try { return require(path.join(process.env.FOLDER_OF_FILES, name)).name; } catch (error) { return error.constructor.name; } };
say("constant key:", outcomeOf(() => { Module._extensions[".js"] = loader; }), Module._extensions[".js"] === loader, require.extensions === Module._extensions);
say("a file of the executable:", require("./inside.js").name, seen.join()); seen.length = 0;
say("DISK a file:", fromDisk("outside" + suffix + ".js"), seen.join()); seen.length = 0;
say("computed key:", outcomeOf(() => { Module._extensions[".kind" + suffix] = loader; }), Module._extensions[".kind"] === loader);
say("DISK a kind of its own:", fromDisk("outside" + suffix + ".kind"), seen.join()); seen.length = 0;
say("strict code:", outcomeOf(function () { "use strict"; Module._extensions[".cjs" + suffix] = loader; }), Module._extensions[".cjs"] === loader);
say("restored:", outcomeOf(() => { Module._extensions[".js"] = original; }), Module._extensions[".js"] === original);
say("deleted:", delete Module._extensions[".kind"], typeof Module._extensions[".kind"]);
`;

test("it is stored, and is handed the files that are read from disk alone, as with --no-aot", async () => {
  using dir = tempDir("aot-a-loader-in-module-extensions", {
    "package.json": `{ "name": "a-loader-in-module-extensions" }`,
    "main.cjs": main,
    "inside.js": `exports.name = "inside";\n`,
    "disk/outside.js": `exports.name = "from disk";\n`,
    "disk/outside.kind": `exports.name = "from disk, a kind of its own";\n`,
  });
  const directory = String(dir);
  const seenWith = async (name: string, ...flags: string[]) => {
    const outfile = join(directory, isWindows ? `${name}.exe` : name);
    const built = await run([bunExe(), "build", "--compile", ...flags, "main.cjs", "--outfile", outfile], directory);
    expect(built.exitCode).toBe(0);
    const { stdout, exitCode } = await run([outfile], directory, {
      ...bunEnv,
      FOLDER_OF_FILES: join(directory, "disk"),
    });
    return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [stock, compiled, withCodeFromDisk] = await Promise.all([
    seenWith("stock", "--no-aot"),
    seenWith("compiled", "--aot"),
    seenWith("with-code-from-disk", "--aot", "--aot-allow-code-from-disk"),
  ]);
  expect(stock.seen).toEqual([
    "SEEN constant key: nothing thrown true true",
    "SEEN a file of the executable: inside ",
    "SEEN DISK a file: from disk outside.js",
    "SEEN computed key: nothing thrown true",
    "SEEN DISK a kind of its own: from disk, a kind of its own outside.kind",
    "SEEN strict code: nothing thrown true",
    "SEEN restored: nothing thrown true",
    "SEEN deleted: true undefined",
  ]);
  expect(withCodeFromDisk).toEqual(stock);
  // Code that is not in the executable is not loaded unless the build allows it.
  const apartFromDisk = (lines: string[]) => lines.filter(line => !line.startsWith("SEEN DISK "));
  expect({ ...compiled, seen: apartFromDisk(compiled.seen) }).toEqual({ ...stock, seen: apartFromDisk(stock.seen) });
});
