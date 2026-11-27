import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

const timeout = 240_000;
const setup = `import { dirname, join } from "node:path";
Bun.plugin({
  name: "made",
  setup(build) {
    build.onResolve({ filter: /q2/ }, args => ({ path: join(args.resolveDir ?? dirname(args.importer), args.path) }));
    build.onLoad({ filter: /q2/ }, () => ({ contents: "made", loader: "text" }));
  },
});
`;
const start = `import "./setup.mjs";
const K = text => String(globalThis.nothing ?? text);
const note = async (label, load) => {
  try {
    console.log(label, (await load()).default);
  } catch (error) {
    console.log(label, "threw", error.name);
  }
};
`;
const programs: Record<string, [string, string]> = {
  "an import with a type": [
    `await note("typed", () => import({ one: "./q2.js?json", two: "./nothing" }[K("one")], { with: { type: "json" } }));
`,
    "typed made\n",
  ],
  "an import with the type text": [
    `await note("typed", () => import({ one: "./q2.js?text", two: "./nothing" }[K("one")], { with: { type: "text" } }));
`,
    "typed made\n",
  ],
  "an import and a require without a type beside one with a type": [
    `await note("import", () => import(K("./q2.js?json")));
await note("require", () => import.meta.require(K("./q2.js?json")));
await note("typed", () => import({ one: "./q2.js?json", two: "./nothing" }[K("one")], { with: { type: "json" } }));
`,
    "import made\nrequire made\ntyped made\n",
  ],
  "a file that the plugin doesn't answer for": [
    `await note("typed", () => import({ one: "./q3.txt", two: "./nothing" }[K("one")], { with: { type: "text" } }));
`,
    "typed on the disk\n\n",
  ],
};

describe("a load plugin of the program is asked before a form of the file", () => {
  for (const [name, [text, stdout]] of Object.entries(programs))
    test.concurrent(
      name,
      async () => {
        using dir = tempDir("aot-plugin-before-form", {
          "setup.mjs": setup,
          "q2.js": `export default "on the disk";\n`,
          "q3.txt": "on the disk\n",
          "entry.mjs": start + text,
        });
        const folder = String(dir);
        const executable = join(folder, isWindows ? "program.exe" : "program");
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", "./entry.mjs", "--outfile", executable],
          folder,
          bunEnv,
        );
        expect(built.exitCode).toBe(0);
        const ran = await spawned([executable], folder, bunEnv);
        expect(ran.stdout).toBe(stdout);
        expect(ran.exitCode).toBe(0);
      },
      timeout,
    );
});
