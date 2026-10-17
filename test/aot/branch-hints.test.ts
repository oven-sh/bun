import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = join(import.meta.dir, "..", "..", "src");

function moduleOf(file: string) {
  const [folder, ...rest] = relative(join(root, "js"), file).split(sep);
  const name = rest.join("/").replace(/\.[jt]s$/, "");
  if (folder === "node" || folder === "internal" || folder === "bun") return `${folder}:${name}`;
  if (file.startsWith(join(root, "aot", "prelude"))) return ".bun-aot-prelude/" + relative(join(root, "aot", "prelude"), file).split(sep).join("/");
  throw new Error(`${file} has a $likely or $unlikely, and this test does not know the name of that module`);
}

function marks() {
  const found: string[] = [];
  for (const folder of [join(root, "js"), join(root, "aot", "prelude")]) {
    for (const name of readdirSync(folder, { recursive: true }) as string[]) {
      if (!/\.[jt]s$/.test(name) || name.endsWith(".d.ts")) continue;
      const text = readFileSync(join(folder, name));
      for (const mark of ["$likely(", "$unlikely("]) {
        for (let at = text.indexOf(mark); at >= 0; at = text.indexOf(mark, at + 1)) found.push(`${moduleOf(join(folder, name))}\t${at}`);
      }
    }
  }
  return found.sort();
}

const files = {
  "main.mjs": readFileSync(join(import.meta.dir, "branch-hints.fixture.mjs"), "utf8"),
  "spelled.js": `
    try {
      console.log($likely(1));
    } catch (error) {
      console.log(error.name);
    }
    try {
      console.log($unlikely(0));
    } catch (error) {
      console.log(error.name);
    }
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

async function build(dir: string, entry: string, name: string, env: Record<string, string>) {
  const executable = join(dir, name + (isWindows ? ".exe" : ""));
  const map = join(dir, name + ".map");
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], dir, { ...bunEnv, ...env, BUN_JSC_aotMapFilePath: map });
  expect({ stderr: built.stderr.split("\n").filter(line => line.startsWith("error")), exitCode: built.exitCode }).toEqual({ stderr: [], exitCode: 0 });
  const used = new Set<string>();
  for (const line of readFileSync(map, "utf8").split("\n")) {
    if (line.startsWith("W\t")) used.add(line.slice(2));
  }
  return { executable, used };
}

test("every $likely and $unlikely in the built-in modules reaches a branch", async () => {
  using dir = tempDir("aot-branch-hints", files);
  const honored = await build(String(dir), "main.mjs", "honored", {});
  expect(marks().filter(mark => !honored.used.has(mark))).toEqual([]);
  const ignored = await build(String(dir), "main.mjs", "ignored", { BUN_JSC_aotIgnoresBranchHintsForTesting: "1" });
  expect([...ignored.used]).toEqual([]);
  const plain = await run([bunExe(), "run", "main.mjs"], String(dir), bunEnv);
  expect(plain.exitCode).toBe(0);
  for (const { executable } of [honored, ignored]) {
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }
}, 480_000);

test("a program cannot spell $likely or $unlikely", async () => {
  using dir = tempDir("aot-branch-hints-spelled", files);
  const { executable, used } = await build(String(dir), "spelled.js", "spelled", {});
  expect([...used].filter(mark => mark.includes("spelled"))).toEqual([]);
  expect(await run([executable], String(dir), bunEnv)).toEqual({ stdout: "ReferenceError\nReferenceError\n", stderr: "", exitCode: 0 });
}, 240_000);
