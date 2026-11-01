// The tests run plain Bun without installing packages: harness/without-installing-packages.ts says how.
// Here a registry on this machine counts what it is asked, and the sources of the tests and tools are read for ways around it.
import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { covers, hasNodeModulesAbove } from "./harness/without-installing-packages";

const missing = "a-package-that-no-test-installs";
const program = `
  const said = [];
  const tried = async (how, load) => {
    try {
      await load();
      said.push(how + ": loaded");
    } catch {
      said.push(how + ": not found");
    }
  };
  const name = ${JSON.stringify(missing.slice(0, 9))} + ${JSON.stringify(missing.slice(9))};
  await tried("require", () => require(${JSON.stringify(missing)}));
  await tried("require of a value", () => require(name));
  await tried("require.resolve", () => require.resolve(${JSON.stringify(missing)}));
  await tried("import()", () => import(${JSON.stringify(missing)}));
  await tried("import() of a value", () => import(name));
  await tried("import.meta.resolve", () => import.meta.resolve(${JSON.stringify(missing)}));
  await tried("Bun.resolveSync", () => Bun.resolveSync(${JSON.stringify(missing)}, process.cwd()));
  await tried("createRequire", () => require("node:module").createRequire(process.cwd() + "/")(${JSON.stringify(missing)}));
  console.log(said.join("\\n"));
`;
const nothingLoaded = [
  "require",
  "require of a value",
  "require.resolve",
  "import()",
  "import() of a value",
  "import.meta.resolve",
  "Bun.resolveSync",
  "createRequire",
].map(how => how + ": not found");

// What the registry was asked for while `command` ran in `cwd`, and what the command printed.
async function ask(command: string[], cwd: string, cache: string) {
  const asked: string[] = [];
  using registry = Bun.serve({
    port: 0,
    fetch(request) {
      asked.push(new URL(request.url).pathname);
      return new Response("{}", { status: 404 });
    },
  });
  await using spawned = Bun.spawn({
    cmd: [bunExe(), ...command],
    cwd,
    env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href, BUN_INSTALL_CACHE_DIR: cache },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
  return { asked, printed: stdout.trim().split("\n") };
}

describe("plain Bun asks no registry for a package that is not installed", () => {
  test("for a file in a temporary folder", async () => {
    using folder = tempDir("installs-no-packages", { "main.mjs": program });
    expect(await ask(["run", "./main.mjs"], String(folder), join(String(folder), "cache"))).toEqual({
      asked: [],
      printed: nothingLoaded,
    });
  });

  test("for text on the command line, started beside the stored programs", async () => {
    using folder = tempDir("installs-no-packages", {});
    expect(await ask(["-e", program], join(import.meta.dir, "parallel"), join(String(folder), "cache"))).toEqual({
      asked: [],
      printed: nothingLoaded,
    });
  });

  // Without this the two tests above would pass with a registry that nobody can reach.
  const outside = basename(tmpdir()) === "aot" ? dirname(tmpdir()) : tmpdir();
  test.skipIf(hasNodeModulesAbove(outside))("and does ask where no folder above holds node_modules", async () => {
    const folder = mkdtempSync(join(outside, "asks-the-registry-"));
    try {
      writeFileSync(join(folder, "main.mjs"), program);
      const { asked } = await ask(["run", "./main.mjs"], folder, join(folder, "cache"));
      expect(asked).toContain("/" + missing);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

const root = import.meta.dir;
const cure = join(root, "harness", "without-installing-packages.ts");
// Programs, and what belongs to them. They are started by a test or a tool, in a folder that it chose.
const programFolders =
  /(^|\/)(node_modules|programs|parallel|library-sweeps|more-programs|apps|app|cases|fixtures|test262|each-case-alone|generated-programs)\//;
const sources = [...new Glob("**/*.{ts,mts,cts}").scanSync({ cwd: root })]
  .map(path => path.replaceAll(sep, "/"))
  .filter(path => !programFolders.test(path) && !path.endsWith(".d.ts"))
  .sort();
const textOf = new Map(sources.map(path => [path, readFileSync(join(root, path), "utf8")]));

function importsOf(path: string): string[] {
  const found: string[] = [];
  for (const [, specifier] of textOf
    .get(path)!
    .matchAll(/^\s*(?:import|export)\b[^"'`;]*?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/gm)) {
    if (!specifier) continue;
    if (specifier === "harness") found.push("harness");
    if (!specifier.startsWith(".")) continue;
    const target = resolve(root, dirname(path), specifier);
    if (target === join(dirname(root), "harness") || target === join(dirname(root), "harness.ts"))
      found.push("harness");
    for (const candidate of [target, target + ".ts", target + ".mts", join(target, "index.ts")]) {
      const inside = relative(root, candidate).replaceAll(sep, "/");
      if (textOf.has(inside)) found.push(inside);
    }
  }
  return found;
}

const reaches = new Map<string, boolean>();
function reachesTheCure(path: string, seen = new Set<string>()): boolean {
  if (path === "harness" || join(root, path) === cure) return true;
  if (reaches.has(path)) return reaches.get(path)!;
  if (seen.has(path)) return false;
  seen.add(path);
  const answer = importsOf(path).some(next => reachesTheCure(next, seen));
  if (answer) reaches.set(path, true);
  return answer;
}

describe("the sources of the tests and tools", () => {
  test("the harness imports the file before it reads the environment", () => {
    expect(existsSync(cure)).toBe(true);
    expect(readFileSync(join(dirname(root), "harness.ts"), "utf8")).toMatch(
      /^import "\.\/aot\/harness\/without-installing-packages";$/m,
    );
  });

  test("whatever takes a temporary folder from the system imports the harness or the file itself", () => {
    const takesATemporaryFolder =
      /^import\b[^;]*\b(tmpdir|mkdtemp|mkdtempSync)\b[^;]*from "(node:)?(os|fs|fs\/promises)";/m;
    expect(sources.filter(path => takesATemporaryFolder.test(textOf.get(path)!) && !reachesTheCure(path))).toEqual([]);
  });

  test("whatever works in a folder of its own choice lays node_modules into it", () => {
    const ownPlace = /["'`]\/(tmp|var\/tmp|dev\/shm)["'`\/]|process\.env\.TMPDIR/;
    // These name such a place for something else than the folder of a program that plain Bun runs.
    const otherUses = new Set([
      "every-image-of-an-executable-has-its-map.test.ts",
      "fuzz/generators/text-that-comes-at-run-time-changes-what-the-program-holds.ts",
      "hardened-environment.test.ts",
      "names-from-run-time-in-a-trimmed-executable.test.ts",
      "plain-bun-installs-no-packages.test.ts",
      "real-apps/run.ts",
      "the-fuzzer-keeps-a-wrong-answer-beside-a-clock.test.ts",
      "trimmed-is-whole/environment-tests.ts",
    ]);
    expect(
      sources.filter(
        path =>
          ownPlace.test(textOf.get(path)!) &&
          !otherUses.has(path) &&
          !textOf.get(path)!.includes("withoutInstallingPackages("),
      ),
    ).toEqual([]);
  });

  test("a Python tool that runs plain Bun lays node_modules too", () => {
    const runsPlainBun = /\[[\w.\[\]"]+, "run", /;
    expect(
      [...new Glob("**/*.py").scanSync({ cwd: root })]
        .map(path => path.replaceAll(sep, "/"))
        .filter(path => !programFolders.test(path))
        .filter(path => {
          const text = readFileSync(join(root, path), "utf8");
          return runsPlainBun.test(text) && !/node_modules|without_installing_packages\(/.test(text);
        })
        .sort(),
    ).toEqual([]);
  });

  test("a test in another folder that compiles ahead of time or trims is covered too", () => {
    const tests = dirname(root);
    const buildsSo = /--(debug-)?aot\b|--trim\b|\b(aot|trim): true\b/;
    expect(
      [...new Glob("{bundler,cli,internal}/**/*.test.ts").scanSync({ cwd: tests })]
        .filter(path => buildsSo.test(readFileSync(join(tests, path), "utf8")) && !covers(join(tests, path)))
        .sort(),
    ).toEqual([]);
    expect(covers(join(tests, "js", "bun", "util", "inspect.test.js"))).toBe(false);
  });

  test("every test reaches it", () => {
    const startsSomething = /\bspawn(Sync)?\(|\bBun\.\$|child_process/;
    expect(
      sources.filter(
        path => path.endsWith(".test.ts") && startsSomething.test(textOf.get(path)!) && !reachesTheCure(path),
      ),
    ).toEqual([]);
  });
});
