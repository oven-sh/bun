// What a function is compiled to does not hang on which file is the entry point, nor on how many files stand between it and the
// entry point. One small server is written in several shapes: its file is the entry point, is imported by the entry point, stands
// behind sixteen files that each import the next one twice, is loaded by import() or by require(), takes its handler from a third
// file, takes createServer from a file that exports it again. Each shape answers the same, and its machine code is within one percent of that of the first shape.
// Each shape is a build of node:http, so there are few: the three with a static import are the ones that have failed.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
  },
});

const handler = `function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/json") {
    const body = JSON.stringify({ hello: "world", n: url.searchParams.get("n") });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 13 });
  res.end("Hello, World!");
}
`;
const types = `import type { IncomingMessage, ServerResponse } from "node:http";\n`;
const createServer = `import { createServer } from "node:http";\n`;
// The server asks itself, so that a shape needs nobody else to show what it answers.
const listen = `const server = createServer(handle);
server.listen(0, "127.0.0.1", async () => {
  const origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  console.log(await (await fetch(origin + "/")).text(), await (await fetch(origin + "/json?n=7")).text());
  server.close();
  server.closeAllConnections();
});
`;
const app = types + createServer + handler + listen;
const chain = (length: number, link: (index: number) => Record<string, string>) =>
  Object.assign({}, ...Array.from({ length }, (_, index) => link(index + 1))) as Record<string, string>;

type Shape = { entry: string; files: Record<string, string> };
/** The first shape of each family is what the others are held against. */
const families: Record<string, Record<string, Shape>> = {
  "node:http in ES modules": {
    "the entry point": { entry: "main.ts", files: { "main.ts": app } },
    "imported by the entry point": { entry: "main.ts", files: { "main.ts": `import "./app";\n`, "app.ts": app } },
    "behind sixteen files that each import the next one twice": {
      entry: "main.ts",
      files: {
        "main.ts": `import "./level1";\n`,
        ...chain(16, index => ({
          [`level${index}.ts`]: `import "./left${index}";\nimport "./right${index}";\n`,
          [`left${index}.ts`]: `import "./level${index + 1}";\n`,
          [`right${index}.ts`]: `import "./level${index + 1}";\n`,
        })),
        "level17.ts": app,
      },
    },
    "the handler in a third file": {
      entry: "main.ts",
      files: {
        "main.ts": `import "./app";\n`,
        "app.ts": createServer + `import { handle } from "./handler";\n` + listen,
        "handler.ts": types + "export " + handler,
      },
    },
    "createServer exported again by a third file": {
      entry: "main.ts",
      files: {
        "main.ts": `import "./app";\n`,
        "app.ts": types + `import { createServer } from "./http";\n` + handler + listen,
        "http.ts": `export { createServer } from "node:http";\n`,
      },
    },
    "loaded by import()": { entry: "main.ts", files: { "main.ts": `await import("./app");\n`, "app.ts": app } },
    "loaded by require()": { entry: "main.cts", files: { "main.cts": `require("./app");\n`, "app.ts": app } },
  },
};

async function build({ entry, files }: Shape) {
  using folder = tempDir("aot-same-code", { ...files, "tsconfig.json": tsconfig });
  const report = join(String(folder), "report.json");
  const flags = ["--aot-report=" + report, "--aot-report-detail=functions"];
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./" + entry, "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, exitCode } = await spawned([executable], String(folder), bunEnv);
  // Not summary.codeBytes: that includes the padding that ends the executable part of the image on a page boundary, so it moves
  // in steps of a page, and a page on Linux arm64 (64 KiB) is two percent of this server.
  const { functions } = JSON.parse(readFileSync(report, "utf8")) as { functions: { codeBytes: number }[] };
  const codeBytes = functions.reduce((sum, { codeBytes }) => sum + codeBytes, 0);
  return { printed: stdout.trim().split("\n").sort(), exitCode, codeBytes };
}

for (const [family, shapes] of Object.entries(families)) {
  const builds = new Map<string, ReturnType<typeof build>>();
  const buildOf = (name: string) => builds.getOrInsertComputed(name, () => slot(() => build(shapes[name])));
  const [first, ...others] = Object.keys(shapes);
  test.concurrent.each(others)(`${family}: %s`, async name => {
    const [reference, shape] = await Promise.all([buildOf(first), buildOf(name)]);
    expect({ printed: shape.printed, exitCode: shape.exitCode }).toEqual({ printed: reference.printed, exitCode: 0 });
    expect(reference.printed[0]).toStartWith("Hello, World! {");
    expect(shape.codeBytes / reference.codeBytes).toBeWithin(0.99, 1.01);
  });
}
