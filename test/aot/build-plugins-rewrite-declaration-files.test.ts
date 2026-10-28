import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const build = `import { writeFileSync } from "fs";
const rewrites = {
  name: "rewrites",
  setup(b: any) {
    b.onLoad({ filter: /note\\.txt$/ }, async (a: any) => {
      await Bun.sleep(Number(process.env.PLUGIN_DELAY_MS));
      for (const [path, text] of Object.entries(JSON.parse(process.env.REWRITES!))) writeFileSync(path, text as string);
      return { contents: "export default " + JSON.stringify(await Bun.file(a.path).text()), loader: "js" };
    });
  },
};
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: true }, plugins: [rewrites], throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [] },
  include: ["*.ts"],
});

type Case = { files: Record<string, string>; rewrites: Record<string, string>; prints: string };

const cases: Record<string, Case> = {
  "a global type": {
    files: {
      "main.ts": `// @ts-ignore\nimport note from "./note.txt";\nconst limit: Limit = 2;\nconsole.log(limit + 1, note);`,
      "globals.d.ts": `type Limit = string;`,
    },
    rewrites: { "globals.d.ts": `type Limit = number;` },
    prints: "3 hello\n",
  },
  "a global type of the same length, in a file only the project includes": {
    files: {
      "main.ts": `// @ts-ignore\nimport note from "./note.txt";\nconst limit: Limit = 2;\nconsole.log(limit + 1, note);`,
      "unused.ts": `declare global {\n  type Limit = string;\n}\nexport {};`,
    },
    rewrites: { "unused.ts": `declare global {\n  type Limit = number;\n}\nexport {};` },
    prints: "3 hello\n",
  },
  "a module that only an included file imports": {
    files: {
      "main.ts": `// @ts-ignore\nimport note from "./note.txt";\nconst limit: Limit = 2;\nconsole.log(limit + 1, note);`,
      "unused.ts": `import "./imported";`,
      "imported.ts": `export {};`,
    },
    rewrites: { "imported.ts": `declare global {\n  type Limit = number;\n}\nexport {};` },
    prints: "3 hello\n",
  },
};

describe.skipIf(!!unsupported)("declaration files that a plugin rewrites during the build", () => {
  for (const [name, { files, rewrites, prints }] of Object.entries(cases)) {
    for (const delay of ["0", "300"]) {
      test.concurrent(`${name}, ${delay} ms into the load`, () =>
        slot(async () => {
          using dir = tempDir("aot-plugin-rewrites", {
            "build.ts": build,
            "tsconfig.json": tsconfig,
            "note.txt": "hello",
            ...files,
          });
          const folder = String(dir);
          const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
          const built = await spawned([bunExe(), "build.ts", executable], folder, {
            ...bunEnv,
            PLUGIN_DELAY_MS: delay,
            REWRITES: JSON.stringify(rewrites),
          });
          expect({ stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
            stdout: "",
            stderr: expect.any(String),
            exitCode: 0,
          });
          const ran = await spawned([executable], folder, bunEnv);
          expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
        }),
      );
    }
  }
});
