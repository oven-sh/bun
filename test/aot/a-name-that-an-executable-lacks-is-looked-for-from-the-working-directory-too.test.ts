import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

const nameOfExecutable = isWindows ? "tool.exe" : "tool";

const part = `
import { rmSync, writeFileSync } from "node:fs";
const made = (name: string) => [".", name].join("/");
const bare = (name: string) => JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(name));
const kindOf = (loaded: any) => (loaded.default ?? loaded).kind;
async function writtenSince(name: string, load: () => unknown) {
  const before = await Promise.resolve().then(load).then(kindOf, error => error.code);
  writeFileSync(name, 'module.exports = { kind: "written since" };');
  try {
    return { kind: [before, kindOf(await load())] };
  } finally {
    rmSync(name);
  }
}
const roads: Record<string, () => unknown> = {
  "import of code": () => import(made("plain.js")),
  "require of code": () => require(made("plain.js")),
  "import of data": () => import(made("data.json")),
  "require of data": () => require(made("data.json")),
  "what the exports of the nearer copy of a package allow": () => require(bare("hides/open.json")),
  "what they refuse": () => require(bare("hides/hidden.json")),
  "a name that the tsconfig.json of the working directory maps": () => require(bare("made-up-settings")),
  "a name that the package.json of the working directory maps": () => require(bare("#made-up-settings")),
  "import of code that was written since it was not found": () => writtenSince("later.cjs", () => import(made("later.cjs"))),
  "require of code that was written since it was not found": () => writtenSince("later.cjs", () => require(made("later.cjs"))),
};
try {
  console.log(JSON.stringify({ answer: kindOf(await roads[process.argv[2]]()) }));
} catch (error: any) {
  console.log(JSON.stringify({ threw: error.code ?? error.name }));
}
`;

const dir = tempDir("aot-looked-for-from-the-working-directory-too", {
  "program/main.ts": `import "./part/main.ts";\n`,
  "program/part/main.ts": part,
  "started-here/plain.js": `module.exports = { kind: "code in the working directory" };\n`,
  "started-here/data.json": `{ "kind": "data in the working directory" }\n`,
  "started-here/part/other.txt": "a folder of the same name as the importer's\n",
  "program/part/node_modules/hides/package.json": JSON.stringify({
    name: "hides",
    exports: { "./open.json": "./open.json" },
  }),
  "program/part/node_modules/hides/open.json": `{ "kind": "the nearer copy" }\n`,
  "program/part/node_modules/hides/hidden.json": `{ "kind": "the nearer copy, hidden" }\n`,
  "started-here/node_modules/hides/open.json": `{ "kind": "the copy of the working directory" }\n`,
  "started-here/node_modules/hides/hidden.json": `{ "kind": "the copy of the working directory" }\n`,
  "started-here/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "./lib" } }),
  "started-here/package.json": JSON.stringify({
    name: "made-up",
    imports: { "#made-up-settings": "./lib/made-up-settings.json" },
  }),
  "started-here/lib/made-up-settings.json": `{ "kind": "by the rules of the working directory" }\n`,
});
afterAll(() => dir[Symbol.dispose]());
const directory = String(dir);

const forms = { bundle: [], closed: ["--aot"], withCodeFromDisk: ["--aot", "--aot-allow-code-from-disk"] };
let built:
  Promise<(form: keyof typeof forms, road: string) => Promise<{ answer?: unknown; threw?: string }>> | undefined;
const setUp = () =>
  (built ??= (async () => {
    for (const [form, flags] of Object.entries(forms)) {
      const outfile = join(directory, form + "-" + nameOfExecutable);
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", ...flags, "./main.ts", "--outfile", outfile],
        join(directory, "program"),
      );
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return async (form, road) => {
      const { stdout, stderr, exitCode } = await run(
        [join(directory, form + "-" + nameOfExecutable), road],
        join(directory, "started-here"),
        bunEnv,
      );
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    };
  })());

test.each([
  "import of code",
  "require of code",
  "import of data",
  "require of data",
  "import of code that was written since it was not found",
  "require of code that was written since it was not found",
])(
  "where code may come from disk: %s",
  async road => {
    const ask = await setUp();
    expect(await ask("withCodeFromDisk", road)).toEqual(await ask("bundle", road));
  },
  600_000,
);

// The sources lie beside the executable: a package name is walked up for from the folder of the importer's source, as under `bun run`, and from nowhere else.
test.each([
  ["what the exports of the nearer copy of a package allow", { answer: "the nearer copy" }],
  ["what they refuse", { threw: "MODULE_NOT_FOUND" }],
  ["a name that the tsconfig.json of the working directory maps", { threw: "MODULE_NOT_FOUND" }],
  ["a name that the package.json of the working directory maps", { threw: "MODULE_NOT_FOUND" }],
])(
  "where code may come from disk: %s",
  async (road, answer) => {
    const ask = await setUp();
    expect(await ask("withCodeFromDisk", road)).toEqual(answer);
  },
  600_000,
);

test.each(["import of data", "require of data"])(
  "a closed executable: %s",
  async road => {
    const ask = await setUp();
    expect(await ask("closed", road)).toEqual(await ask("bundle", road));
  },
  600_000,
);
