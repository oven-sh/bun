// Bun.serve starts the development server, which bundles files from the disk when it runs and runs them beside the program. Where
// the compiler sees `app`, the world is open, and the server answers as in the whole executable. Where it does not see the options
// the call throws an EvalError, whole or trimmed: a server whose options nobody follows would open the world of every such program.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./run-programs";

const framework = `{
  fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: entry }],
  serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: entry, serverRegisterClientReferenceExport: "registerClientReference" },
}`;
const asks = `const response = await fetch(server.url);
console.log("answer:", response.status, await response.text());
server.stop(true);
process.exit(0);
`;
const programs: Record<string, string> = {
  "app is written": `const entry = process.cwd() + "/entry.ts";\nconst server = Bun.serve({ port: 0, app: { root: process.cwd(), framework: ${framework} } });\n${asks}`,
  "the options are not seen": `const entry = process.cwd() + "/entry.ts";\nconst server = Bun.serve(JSON.parse(JSON.stringify({ port: 0, app: { root: process.cwd(), framework: ${framework} } })));\n${asks}`,
};
const late = {
  "entry.ts": `export function render(request, meta) { return meta.pageModule.default(request, meta); }\nexport function registerClientReference(value, file, uid) { return { value, file, uid }; }\n`,
  "routes/index.ts": `export default function () { return new Response("late code " + [1, 2, 3].map(n => n * 2).join()); }\n`,
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

using probe = tempDir("development-server-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stderr: "pipe",
});

(probed.exitCode !== 0 || unsupported || isWindows ? describe.skip : describe.concurrent)(
  "the development server in a trimmed executable answers as in the whole one",
  () => {
    for (const [name, source] of Object.entries(programs)) {
      (name === "the options are not seen" ? test.todo : test)(
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
                [bunExe(), "build", "--compile", "--aot", ...flags, "program.mjs", "--outfile", kind],
                String(dir),
              );
              expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
                stderr: expect.not.stringMatching(/^error\b/m),
                exitCode: 0,
              });
              const ran = await run([join(String(dir), kind)], String(dir));
              answers[kind] = {
                answer: ran.stdout.split("\n").filter(line => line.startsWith("answer:")),
                exitCode: ran.exitCode,
              };
            }
            expect(answers).toEqual({
              whole: { answer: ["answer: 200 late code 2,4,6"], exitCode: 0 },
              trimmed: { answer: ["answer: 200 late code 2,4,6"], exitCode: 0 },
            });
          }),
        600_000,
      );
    }
  },
);
