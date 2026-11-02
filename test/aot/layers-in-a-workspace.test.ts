import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A workspace: two packages of the project are linked into node_modules, so one file has a path in a package folder and a path outside it, and it is reached
// by the package's name, by a relative path, by a tsconfig alias and from an installed package. It must be one module with one state in whichever layer it lands.
// Beside that: `imports` and conditions of package.json, a package with an ES and a CommonJS form, test files that import a test file, .mts and .cjs test files,
// a path that a test computes and the application loads, a folder with a space and a file with an umlaut.
const folder = join(import.meta.dir, "layers-in-a-workspace");
const files = Object.fromEntries(
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .map(path => [
      path
        .slice(folder.length + 1)
        .replaceAll("\\", "/")
        .replace(/^installed\//, "node_modules/")
        .replace("with-space/d-spaced-name.fixture.", "with space/d spaced näme.fixture.")
        .replace(/\.fixture\.(\w+)$/, ".test.$1"),
      readFileSync(path, "utf8"),
    ]),
);

async function seenIn(from: string, words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-layers-in-a-workspace", files);
  mkdirSync(join(String(dir), "node_modules", "@scope"), { recursive: true });
  for (const name of ["shared", "app"])
    symlinkSync(join(String(dir), "packages", name), join(String(dir), "node_modules", "@scope", name), "junction");
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], join(String(dir), from), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN|"));
  return { seen: seen.sort(), exitCode };
}

test("a workspace answers as under plain bun test, started at its root and in a package", async () => {
  const ways = [".", "packages/app"].map(from =>
    Promise.all([
      seenIn(from, undefined),
      seenIn(from, "TestRunLayers:0", "--aot"),
      seenIn(from, "TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    ]),
  );
  for (const [plain, one, layers] of await Promise.all(ways)) {
    expect(plain.seen.length).toBe(12);
    expect(plain.seen.filter(line => line.includes("THROWS"))).toEqual([]);
    expect(plain.exitCode).toBe(0);
    expect(one).toEqual(plain);
    expect(layers).toEqual(plain);
  }
}, 240_000);
