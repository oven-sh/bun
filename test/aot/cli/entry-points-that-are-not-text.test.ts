import { afterAll, expect } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { beforeAll, describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;

// Neither UTF-8 nor the start of any token, the same in every run. One executable holds both, so they differ in length.
const noise = (length: number) => Buffer.from(Array.from({ length }, (_, index) => 0x80 | ((index * 37) % 0x80)));
const table = noise(3000);
const blob = noise(2000);
const typed = `const n: number = 41;\nconsole.log("ran", n + 1);\nmodule.exports = { n };\n`;

// Prints a line for each file that the executable holds, and what `require` answers for a file whose name says nothing about it.
const listsItsFiles = `// A name as it is, but for the hash of the contents.
const withoutHash = (name: string) => name.replace(/-[a-z0-9]+\\./, ".");
const lines: string[] = [];
for (const file of Bun.embeddedFiles as readonly (Blob & { name: string })[]) {
  const sha256 = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex");
  lines.push([withoutHash(file.name), file.size, sha256].join(" "));
}
for (const line of lines.sort()) console.log(line);
const tool = require("./tool.unknown");
// An executable answers a path. The part behind its folder is printed.
console.log("required", typeof tool === "string" ? withoutHash(tool.replace(/^.*[\\\\/]/, "")) : tool.n);
`;
/** The line that the program prints for a file with these contents. */
const held = (name: string, contents: string | Buffer) =>
  [name, Buffer.byteLength(contents), new Bun.CryptoHasher("sha256").update(contents).digest("hex")].join(" ");

// One folder for all tests. A build writes a copy of Bun, so each command line is built once and its executable is started once.
// The folder is made before the first test that runs: a run that selects none of them leaves nothing behind.
let dir: ReturnType<typeof tempDir> | undefined;
let folder = "";
beforeAll(() => {
  dir = tempDir("aot-entry-points-not-text", {
    "app.ts": listsItsFiles,
    "table.unknown": table,
    "store/blob": blob,
    "tool.unknown": typed,
    "tool": Buffer.from(`// caf\xe9\nconsole.log("ran");\n`, "latin1"),
  });
  folder = String(dir);
  if (!isWindows) symlinkSync(join("store", "blob"), join(folder, "linked.node"));
});
const furtherEntryPoints = isWindows ? ["table.unknown"] : ["table.unknown", "linked.node"];
const namesOfHeld = isWindows ? ["table.unknown", "tool.unknown"] : ["blob.", "table.unknown", "tool.unknown"];

const executables = new Map<string, ReturnType<typeof spawned>>();
afterAll(async () => {
  // A test that has failed does not wait for the builds of the others.
  await Promise.allSettled(executables.values());
  dir?.[Symbol.dispose]();
}, buildLimit);

/** What the executable of `entryPoints` prints, and how it ends. */
function outputOf(mode: string[], entryPoints: string[]) {
  return executables.getOrInsertComputed(JSON.stringify([mode, entryPoints]), () => {
    const name = `built-${executables.size}`;
    return slot(async () => {
      built(await spawned([bunExe(), "build", "--compile", ...mode, ...entryPoints, "--outfile", name], folder, env));
      return await spawned([join(folder, isWindows ? `${name}.exe` : name)], folder, env);
    });
  });
}

/** The lines that the executable of app.ts and the further entry points prints. */
async function app(mode: string[]) {
  const { stdout, ...ended } = await outputOf(mode, ["app.ts", ...furtherEntryPoints]);
  const lines = stdout.split("\n");
  // It holds nothing else, and nothing twice.
  expect({ names: lines.map(line => line.split(" ")[0]), ...ended }).toEqual({
    names: [...namesOfHeld, "required", ""],
    stderr: "",
    exitCode: 0,
    signal: null,
  });
  return lines;
}

describe.concurrent("a further entry point that is not text", () => {
  test(
    "is embedded as a file when its extension is unknown",
    async () => {
      const [compiled, plain] = await Promise.all([app(["--aot"]), app([])]);
      expect(compiled).toContain(held("table.unknown", table));
      expect(compiled).toEqual(plain);
    },
    buildLimit,
  );

  test.skipIf(isWindows)(
    "is embedded as a file when it is a link to a file without an extension",
    async () => {
      const [compiled, plain] = await Promise.all([app(["--aot"]), app([])]);
      expect(compiled).toContain(held("blob.", blob));
      expect(compiled).toEqual(plain);
    },
    buildLimit,
  );
});

describe.concurrent("text in a file whose name says nothing about it", () => {
  test(
    "runs as TypeScript as an entry point, and is carried as a file where the program requires it",
    async () => {
      const [alone, compiled, plain, underBun] = await Promise.all([
        outputOf(["--aot"], ["tool.unknown"]),
        app(["--aot"]),
        app([]),
        slot(() => spawned([bunExe(), "app.ts"], folder, env)),
      ]);
      expect(alone).toEqual({ stdout: "ran 42\n", stderr: "", exitCode: 0, signal: null });
      // An executable holds the file as it is, with --aot and without, and `require` answers its path. `bun run` reads it as code.
      expect(compiled).toContain(held("tool.unknown", typed));
      expect(compiled).toContain("required tool.unknown");
      expect(compiled).toEqual(plain);
      expect(underBun).toEqual({ stdout: "ran 42\nrequired 41\n", stderr: "", exitCode: 0, signal: null });
    },
    buildLimit,
  );

  test(
    "runs though a comment in it is not UTF-8",
    async () => {
      expect(await outputOf(["--aot"], ["tool"])).toEqual({ stdout: "ran\n", stderr: "", exitCode: 0, signal: null });
    },
    buildLimit,
  );
});
