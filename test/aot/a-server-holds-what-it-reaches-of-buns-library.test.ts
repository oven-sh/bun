// An executable holds of Bun's own library what the program reaches by constant names and by bindings. One row of the table of
// built-ins, or one load under a computed name in a function that native code calls for Bun.serve, is enough to bring in all of
// it: the counts here are far below what the whole library takes (over 4,000 functions).
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

async function run(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
}

async function build(directory: string, entry: string) {
  const executable = join(directory, entry.replace(".js", isWindows ? ".exe" : ""));
  const report = join(directory, entry + ".report.json");
  const flags = ["--aot-report=" + report, "--aot-report-detail=functions"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", executable],
    directory,
  );
  expect({ errors: built.errors, exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
  const { statistics, functions } = (await Bun.file(report).json()) as {
    statistics: Record<string, number>;
    functions: { file: string }[];
  };
  return { executable, functionsLowered: statistics.FunctionsLowered, files: new Set(functions.map(it => it.file)) };
}

test("a program that prints a line lowers a small part of Bun's library", async () => {
  using dir = tempDir("aot-library-of-a-line", { "prints.js": `console.log("a line");\n` });
  const directory = String(dir);
  const prints = await build(directory, "prints.js");
  expect(prints.functionsLowered).toBeLessThan(1000);
  expect(await run([prints.executable], directory)).toEqual({ stdout: "a line\n", errors: [], exitCode: 0 });
});

test("a program that calls Bun.serve lowers little more of Bun's library than one that fetches", async () => {
  using dir = tempDir("aot-library-of-a-server", {
    "fetches.js": `const response = await fetch(process.argv[2]).catch(error => error);\nconsole.log(typeof response);\n`,
    "serves.js": `const server = Bun.serve({ port: 0, fetch: request => new Response("hello " + new URL(request.url).pathname) });
const response = await fetch(new URL("/a", server.url));
console.log(response.status, await response.text());
await server.stop(true);
`,
  });
  const directory = String(dir);
  const fetches = await build(directory, "fetches.js");
  const serves = await build(directory, "serves.js");
  expect(fetches.functionsLowered).toBeLessThan(1000);
  expect(serves.functionsLowered - fetches.functionsLowered).toBeLessThan(100);
  expect(await run([serves.executable], directory)).toEqual({ stdout: "200 hello /a\n", errors: [], exitCode: 0 });
});

test("the methods of a constructor function of the library are lowered for a program that names the function", async () => {
  using dir = tempDir("aot-library-methods-of-a-function", {
    "writes.js": `process.stdout.write("a line\\n");\n`,
    "parses.js": `import url from "node:url";\nprocess.stdout.write(url.parse("http://a.example/b?c=d").pathname + "\\n");\n`,
  });
  const directory = String(dir);
  const writes = await build(directory, "writes.js");
  const parses = await build(directory, "parses.js");
  // What stands behind process.stdout evaluates node:url too. As it is evaluated, the module stores parse, parseHost, resolveObject
  // and others into Url.prototype: they are reached with Url, not with the module.
  expect(parses.functionsLowered - writes.functionsLowered).toBeGreaterThan(20);
  expect(await run([writes.executable], directory)).toEqual({ stdout: "a line\n", errors: [], exitCode: 0 });
  expect(await run([parses.executable], directory)).toEqual({ stdout: "/b\n", errors: [], exitCode: 0 });
});

test("a program that imports one name of a library module lowers less than one that imports the module", async () => {
  const serves = (head: string, create: string) => `${head}
const server = ${create}((request, response) => response.end("hello " + request.url));
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/a");
  console.log(answer.status, await answer.text());
  server.close();
});
`;
  using dir = tempDir("aot-library-one-name-of-a-module", {
    "name.js": serves(`import { createServer } from "node:http";`, "createServer"),
    "module.js": serves(`import http from "node:http";`, "http.createServer"),
  });
  const directory = String(dir);
  const name = await build(directory, "name.js");
  const module = await build(directory, "module.js");
  // The client's half of node:http: ClientRequest and its methods, request(), get().
  expect(module.functionsLowered - name.functionsLowered).toBeGreaterThan(50);
  expect(await run([name.executable], directory)).toEqual({ stdout: "200 hello /a\n", errors: [], exitCode: 0 });
  expect(await run([module.executable], directory)).toEqual({ stdout: "200 hello /a\n", errors: [], exitCode: 0 });
});

test("a program that imports names of node:fs lowers little more than one that imports nothing", async () => {
  using dir = tempDir("aot-library-names-of-the-file-system", {
    "nothing.js": `console.log(0);\n`,
    "written.js": `import { existsSync } from "node:fs";\nconsole.log(existsSync("/") ? 0 : 1);\n`,
    "bound.js": `import { readFileSync, constants } from "node:fs";\nconsole.log(readFileSync(process.execPath).length > constants.F_OK ? 0 : 1);\n`,
    "module.js": `import fs from "node:fs";\nconsole.log(fs.existsSync("/") ? 0 : 1);\n`,
  });
  const directory = String(dir);
  const [nothing, written, bound, module] = [
    await build(directory, "nothing.js"),
    await build(directory, "written.js"),
    await build(directory, "bound.js"),
    await build(directory, "module.js"),
  ];
  expect(module.functionsLowered - nothing.functionsLowered).toBeGreaterThan(1500);
  expect(written.functionsLowered - nothing.functionsLowered).toBeLessThan(300);
  expect(bound.functionsLowered - nothing.functionsLowered).toBeLessThan(300);
  for (const built of [nothing, written, bound, module])
    expect(await run([built.executable], directory)).toEqual({ stdout: "0\n", errors: [], exitCode: 0 });
});

test("a server holds the half of a cluster's worker only where the program names node:cluster", async () => {
  const serves = `import { createServer } from "node:http";
const server = createServer((request, response) => response.end("hello " + request.url));
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/a");
  console.log(answer.status, await answer.text());
  server.close();
});
`;
  using dir = tempDir("aot-library-worker-of-a-cluster", {
    "alone.js": serves,
    "named.js": `import "node:cluster";\n` + serves,
  });
  const directory = String(dir);
  const alone = await build(directory, "alone.js");
  const named = await build(directory, "named.js");
  expect(alone.files.has("internal/cluster/child")).toBe(false);
  expect(named.files.has("internal/cluster/child")).toBe(true);
  expect(await run([alone.executable], directory)).toEqual({ stdout: "200 hello /a\n", errors: [], exitCode: 0 });
  expect(await run([named.executable], directory)).toEqual({ stdout: "200 hello /a\n", errors: [], exitCode: 0 });
});

test("a library module that the library reads by a few names is not lowered whole", async () => {
  using dir = tempDir("aot-library-module-read-by-names", {
    "writes.js": `process.stdout.write("a line\\n");\n`,
    "walks.js": `import util from "node:util";\nprocess.stdout.write(String(Object.values(util).length > 10) + "\\n");\n`,
  });
  const directory = String(dir);
  const writes = await build(directory, "writes.js");
  const walks = await build(directory, "walks.js");
  // What stands behind process.stdout loads node:util too, and reads some of its exports by their names.
  expect(walks.functionsLowered - writes.functionsLowered).toBeGreaterThan(20);
  expect(await run([writes.executable], directory)).toEqual({ stdout: "a line\n", errors: [], exitCode: 0 });
  expect(await run([walks.executable], directory)).toEqual({ stdout: "true\n", errors: [], exitCode: 0 });
});
