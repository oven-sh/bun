// Bun.serve starts the development server, which bundles files from the disk when it runs and runs them beside the program. Where
// the compiler sees `app`, the world is open, and the server answers as in the whole executable. Where it does not see the options
// the call throws a TypeError that says so, whole or trimmed: a server whose options nobody follows would open the world of every such program.
// The refusal asks the executable and not the call, so it holds where the compiler does not see which function is called either. Proofs rest
// on it: the late code stores over Date, which compiled code takes for a constant wherever the world is closed.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const framework = `{
  fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: entry }],
  serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: entry, serverRegisterClientReferenceExport: "registerClientReference" },
}`;
const asks = `const response = await fetch(server.url);
console.log("answer:", response.status, await response.text(), typeof Date.now());
server.stop(true);
process.exit(0);
`;
const oneOfTwo = `const other = options => ({ url: "none", stop() {} });\nconst flag = JSON.parse("true");\n`;
const refusal =
  "TypeError: app: this executable only runs code that was compiled into it, and the build didn't see your code pass this option. Write it in the object that Bun.serve() is called with";
const programs: Record<string, { isRefused: boolean; source: string }> = {
  "app is written": {
    isRefused: false,
    source: `const entry = process.cwd() + "/entry.ts";\nconst server = Bun.serve({ port: 0, app: { root: process.cwd(), framework: ${framework} } });\n${asks}`,
  },
  "the options are not seen": {
    isRefused: true,
    source: `const entry = process.cwd() + "/entry.ts";\nconst server = Bun.serve(JSON.parse(JSON.stringify({ port: 0, app: { root: process.cwd(), framework: ${framework} } })));\n${asks}`,
  },
  "the function called is one of two and app is written": {
    isRefused: false,
    source: `const entry = process.cwd() + "/entry.ts";\n${oneOfTwo}const server = (flag ? Bun.serve : other)({ port: 0, app: { root: process.cwd(), framework: ${framework} } });\n${asks}`,
  },
  "the function called is one of two and the options are not seen": {
    isRefused: true,
    source: `const entry = process.cwd() + "/entry.ts";\n${oneOfTwo}const server = (flag ? Bun.serve : other)(JSON.parse(JSON.stringify({ port: 0, app: { root: process.cwd(), framework: ${framework} } })));\n${asks}`,
  },
};
const late = {
  "entry.ts": `export function render(request, meta) { return meta.pageModule.default(request, meta); }\nexport function registerClientReference(value, file, uid) { return { value, file, uid }; }\n`,
  "routes/index.ts": `globalThis.Date = { now: () => "stored over" };\nexport default function () { return new Response("late code " + [1, 2, 3].map(n => n * 2).join()); }\n`,
};

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({
    cmd,
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

(!canTrim || unsupported ? describe.skip : describe.concurrent)(
  "the development server in a trimmed executable answers as in the whole one",
  () => {
    for (const [name, { isRefused, source }] of Object.entries(programs)) {
      test(
        name,
        () =>
          slot(async () => {
            using dir = tempDir("development-server", { "program.mjs": source, ...late });
            const answers: Record<string, unknown> = {};
            for (const [kind, flags] of [
              ["whole", []],
              ["trimmed", ["--trim"]],
            ] as const) {
              const build = await run(
                [
                  bunExe(),
                  "build",
                  "--compile",
                  ...withoutDebugInformation,
                  "--aot",
                  ...flags,
                  "program.mjs",
                  "--outfile",
                  kind,
                ],
                String(dir),
              );
              expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
                stderr: expect.not.stringMatching(/^error\b/m),
                exitCode: 0,
              });
              const ran = await run([join(String(dir), kind)], String(dir));
              answers[kind] = {
                answer: ran.stdout.split("\n").filter(line => line.startsWith("answer:")),
                isRefused: ran.stderr.includes(refusal),
                exitCode: ran.exitCode,
              };
            }
            const expected = isRefused
              ? { answer: [], isRefused, exitCode: 1 }
              : { answer: ["answer: 200 late code 2,4,6 string"], isRefused, exitCode: 0 };
            expect(answers).toEqual({ whole: expected, trimmed: expected });
          }),
        600_000,
      );
    }
  },
);
