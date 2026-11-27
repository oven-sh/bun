import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

const timeout = 240_000;
const plugin = `Bun.plugin({
  name: "made",
  setup(build) {
    build.onLoad({ filter: /\\.vue$/ }, args => ({ contents: 'export const k = "made"; export default 1;', loader: "js" }));
  },
});
`;
const known = `const name = value => String(globalThis.nothing ?? value);
`;
const programs: Record<string, [string, string]> = {
  "an import() and a require() of it": [
    `${plugin}${known}const keys = value => Object.keys(value).sort().join();
console.log("require", keys(import.meta.require(\`./a\${name(".vue")}\`)));
console.log("import", keys(await import(\`./\${name("a")}.vue\`)));
`,
    "require default,k\nimport default,k\n",
  ],
  "an import() after a require() that nothing starts": [
    `${plugin}${known}const keys = value => Object.keys(value).sort().join();
if (process.env.AOT_NEVER) import.meta.require(\`./a\${name(".vue")}\`);
console.log("import", keys(await import(\`./\${name("a")}.vue\`)));
`,
    "import default,k\n",
  ],
  "a text file beside an import() of its text": [
    `${plugin.replace("vue", "txt")}${known}const keys = value => Object.keys(value).sort().join();
console.log("import", keys(await import(name("./b.txt"))));
console.log("text", keys(await import(\`./b\${name(".txt")}\`, { with: { type: "text" } })));
`,
    "import default,k\ntext default,k\n",
  ],
  "no plugin for it": [
    `${known}const file = (await import(\`./\${name("a")}.vue\`)).default;
if (process.env.AOT_NEVER) import.meta.require(\`./a\${name(".vue")}\`);
console.log("import", typeof file, file.endsWith(".vue"));
`,
    "import string true\n",
  ],
};

describe("a file of an unknown kind that a load plugin of the program answers for", () => {
  for (const [name, [entry, stdout]] of Object.entries(programs))
    test.concurrent(
      name,
      async () => {
        using dir = tempDir("aot-plugin-unknown-kind", {
          "a.vue": "<template/>\n",
          "b.txt": "text\n",
          "entry.mjs": entry,
        });
        const folder = String(dir);
        const plain = await spawned([bunExe(), "entry.mjs"], folder, bunEnv);
        expect(plain.stdout).toBe(stdout);
        const executable = join(folder, isWindows ? "program.exe" : "program");
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", "./entry.mjs", "--outfile", executable],
          folder,
          bunEnv,
        );
        expect(built.exitCode).toBe(0);
        expect((await spawned([executable], folder, bunEnv)).stdout).toBe(stdout);
      },
      timeout,
    );
});
