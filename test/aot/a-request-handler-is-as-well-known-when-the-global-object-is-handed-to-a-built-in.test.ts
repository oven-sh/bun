// Bun.serve keeps `fetch` where only native code finds it, and calls it with a new Request. What the handler reads of its request
// costs the same whether or not the program also hands `globalThis` to a built-in: nobody gets from there to the handler.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(240_000);

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

const server = `const server = Bun.serve({
  port: 0,
  fetch(request: Request) {
    return new Response(request.method + " " + request.url.length);
  },
});
const answer = await fetch(\`http://127.0.0.1:\${server.port}/a\`);
console.log((await answer.text()).slice(0, 3));
server.stop(true);
`;

async function build(source: string) {
  using folder = tempDir("aot-known-handler", { "main.ts": source, "tsconfig.json": tsconfig });
  const report = join(String(folder), "report.json");
  const executable = join(String(folder), isWindows ? "main.exe" : "main");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, "./main.ts", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, exitCode } = await spawned([executable], String(folder), bunEnv);
  const { tested, free } = JSON.parse(readFileSync(report, "utf8")).summary.accesses as {
    tested: number;
    free: number;
  };
  return { stdout: stdout.trim(), exitCode, tested, free };
}

const known = { stdout: "GET", exitCode: 0, tested: 0, free: 2 };

test("the handler reads its request without a test", async () => {
  expect(await build(server)).toEqual(known);
});

// TODO: the handler counts as one that anybody may call, and each read of the request is tested.
test.todo("so it does where the global object is handed to Promise.race", async () => {
  expect(await build("void Promise.race([globalThis]);\n" + server)).toEqual(known);
});
