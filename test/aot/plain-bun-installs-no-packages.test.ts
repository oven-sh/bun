// The tests run plain Bun without installing packages: harness/without-installing-packages.ts says how.
// Here a registry on this machine counts what it is asked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, test } from "./harness/declare";
import { hasNodeModulesAbove } from "./harness/without-installing-packages";

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
