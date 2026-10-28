import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./run-programs";

const app = `{
  root: process.cwd(),
  framework: {
    fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: entry }],
    serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: entry, serverRegisterClientReferenceExport: "registerClientReference" },
  },
}`;
const head = `const entry = process.cwd() + "/entry.ts";\n`;
const asks = `const response = await fetch(server.url);
console.log("answer:", response.status, await response.text());
server.stop(true);
process.exit(0);
`;
const late = {
  "entry.ts": `export function render(request, meta) { return meta.pageModule.default(request, meta); }\nexport function registerClientReference(value, file, uid) { return { value, file, uid }; }\n`,
  "routes/index.ts": `export default function () { return new Response("late code " + [1, 2, 3].map(n => n * 2).join()); }\n`,
};

const seen: Record<string, [string, string]> = {
  "app is written in the literal of the call": [
    "program.mjs",
    `${head}const server = Bun.serve({ port: 0, app: ${app} });\n${asks}`,
  ],
  "app comes into the literal by a spread": [
    "program.mjs",
    `${head}const development = { app: ${app} };\nconst server = Bun.serve({ port: 0, ...development });\n${asks}`,
  ],
  "the options go through a function that starts a plain server too": [
    "program.mjs",
    `${head}function start(options) { return Bun.serve(options); }\nconst quiet = start({ port: 0, fetch() { return new Response("quiet"); } });\nquiet.stop(true);\nconst server = start({ port: 0, app: ${app} });\n${asks}`,
  ],
  "the program is TypeScript": [
    "program.ts",
    `${head}const server = Bun.serve({ port: 0, app: ${app} } as any);\n${asks}`,
  ],
};
const notSeen = ["the options are parsed at run time", "app is stored into the options behind their literal"];

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

(unsupported || isWindows ? describe.skip : describe.concurrent)(
  "Bun.serve starts the development server in a compiled executable",
  () => {
    for (const [name, [file, source]] of Object.entries(seen)) {
      test(
        name,
        () =>
          slot(async () => {
            using dir = tempDir("development-server", { [file]: source, ...late });
            const build = await run(
              [bunExe(), "build", "--compile", "--aot", file, "--outfile", "program"],
              String(dir),
            );
            expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
              stderr: expect.not.stringMatching(/^error\b/m),
              exitCode: 0,
            });
            const ran = await run([join(String(dir), "program")], String(dir));
            expect({
              answer: ran.stdout.split("\n").filter(line => line.startsWith("answer:")),
              exitCode: ran.exitCode,
            }).toEqual({ answer: ["answer: 200 late code 2,4,6"], exitCode: 0 });
          }),
        600_000,
      );
    }
    for (const name of notSeen) test.todo(name);
  },
);
