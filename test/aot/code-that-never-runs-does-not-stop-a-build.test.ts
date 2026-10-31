import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { run } from "./harness/run";
import { test } from "./supported";

async function build(folder: string, entry = "main.ts") {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  const result = await spawned(
    [bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable],
    folder,
    bunEnv,
  );
  built(result);
  return { executable, stderr: result.stderr };
}

const brokenPage = `<!doctype html><html><head><script type="module" src="/assets/no-such.js"></script>
<link rel="stylesheet" href="/assets/no-such.css"></head><body><img src="/no-such.svg"></body></html>`;
const goodPage = `<!doctype html><html><body><h1>good</h1></body></html>`;

test("a file that only require.resolve names is neither bundled nor embedded, whatever it holds", async () => {
  using dir = tempDir("aot-resolve-only-page", {
    "main.ts": `
      const name = process.argv[2];
      const path = require.resolve("./pages/" + name);
      console.log(path.endsWith(name), await Bun.file(path).exists());
    `,
    "tsconfig.json": "{}",
    "pages/index.html": brokenPage,
    "pages/logo.svg": "<svg></svg>",
  });
  const { executable, stderr } = await build(String(dir));
  expect(stderr).not.toContain("no-such");
  // require.resolve() says where the file lay when the program was built, as with `bun build --compile`. It is found there as long as it is there, and nowhere else.
  for (const isOnDisk of [true, false]) {
    if (!isOnDisk) rmSync(join(String(dir), "pages"), { recursive: true });
    for (const name of ["index.html", "logo.svg"]) {
      const { stdout, exitCode } = await spawned([executable, name], String(dir), bunEnv);
      expect(stdout).toBe(`true ${isOnDisk}\n`);
      expect(exitCode).toBe(0);
    }
  }
}, 60_000);

test("a page that only require.resolve names is not bundled beside a require of an unknown path", async () => {
  using dir = tempDir("aot-resolve-only-page-beside-unknown-require", {
    "main.ts": `
      const path = require.resolve("./pages/" + process.argv[2]);
      try {
        console.log(typeof require(process.argv[3] ?? path));
      } catch (error) {
        console.log(String(error));
      }
    `,
    "tsconfig.json": "{}",
    "pages/index.html": brokenPage,
  });
  const { executable, stderr } = await build(String(dir));
  expect(stderr).not.toContain("no-such");
  const { stdout, exitCode } = await spawned([executable, "index.html"], String(dir), bunEnv);
  expect(stdout).toBe(
    "Error: Cannot load 'index.html': the page isn't bundled into this executable, because no import or require() names it\n",
  );
  expect(exitCode).toBe(0);
}, 60_000);

test("a page that the program imports and that cannot bundle is an error of the build, as under bun build --compile", async () => {
  using dir = tempDir("aot-page-that-cannot-bundle", {
    "main.ts": `
      if (process.argv[2] === "load") console.log(Object.keys(await import("./page.html")));
      console.log("end");
    `,
    "tsconfig.json": "{}",
    "page.html": brokenPage,
  });
  const { stderr, exitCode } = await spawned(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(String(dir), "program")],
    String(dir),
    bunEnv,
  );
  expect(stderr).toContain("no-such.js");
  expect(exitCode).not.toBe(0);
}, 60_000);

test("bun test --aot bundles a page when it is served, from what the file holds then", async () => {
  using dir = tempDir("aot-test-page-served-fresh", {
    "page.test.ts": `
      import { expect, test } from "bun:test";
      import page from "./page.html";
      import broken from "./broken.html";
      test("edited", async () => {
        await Bun.write(import.meta.dir + "/page.html", "<!doctype html><html><body><h1>edited</h1></body></html>");
        const server = Bun.serve({ port: 0, routes: { "/": page, "/broken": broken } });
        expect(await (await fetch(server.url)).text()).toContain("<h1>edited</h1>");
        expect((await fetch(new URL("/broken", server.url))).status).toBe(500);
        server.stop(true);
      });
    `,
    "page.html": goodPage,
    "broken.html": brokenPage,
  });
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect(plain.stderr).toMatch(/^ *1 pass$/m);
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(compiled.stderr).toMatch(/^ *1 pass$/m);
  expect(compiled.exitCode).toBe(0);
}, 60_000);

test("ShadowRealm stops no build: a compiled program has no such global", async () => {
  using dir = tempDir("aot-shadow-realm-absent", {
    "main.js": `
      console.log(typeof ShadowRealm);
      if (process.argv[2] === "use") {
        try {
          new ShadowRealm();
        } catch (error) {
          console.log(error.name);
        }
      }
      console.log("end");
    `,
    "tsconfig.json": "{}",
  });
  const { executable, stderr } = await build(String(dir), "main.js");
  expect(stderr).toContain("TS100076");
  expect((await spawned([executable], String(dir), bunEnv)).stdout).toBe("undefined\nend\n");
  expect((await spawned([executable, "use"], String(dir), bunEnv)).stdout).toBe("undefined\nReferenceError\nend\n");
  expect(existsSync(executable)).toBe(true);
}, 60_000);

test("a test that uses ShadowRealm fails alone", async () => {
  using dir = tempDir("aot-test-shadow-realm", {
    "uses.test.js": `
      import { expect, test } from "bun:test";
      test("uses", () => {
        expect(new ShadowRealm().evaluate("1 + 2")).toBe(3);
      });
      test("does not", () => {
        expect(1).toBe(1);
      });
    `,
    "other.test.ts": `
      import { expect, test } from "bun:test";
      test("other", () => {
        expect(1).toBe(1);
      });
    `,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(stderr).toMatch(/^ *2 pass$/m);
  expect(stderr).toMatch(/^ *1 fail$/m);
  expect(exitCode).toBe(1);
}, 60_000);
