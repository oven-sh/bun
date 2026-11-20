// Whether the fields of a class are assigned or defined is "useDefineForClassFields" in tsconfig.json.
// `bun run` takes it from the tsconfig.json in the working directory, for every file. `bun build --compile` takes it from the one nearest to each file, with --aot too.
// A class with a field under a key that has to be computed defines its fields whatever the option says. `bun run` works out `"a" + "b"`; `bun build` doesn't unless it minifies.
// With --aot the key is worked out where `bun run`, started in the directory of the build, would assign. So no file answers otherwise than both `bun run` and `bun build --compile`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const says = (assigns: boolean) => JSON.stringify({ compilerOptions: { useDefineForClassFields: !assigns } });
const named = (name: string) => JSON.stringify({ name, main: "index.ts" });
// Prints the label, then what happened to a class with written keys and to one with `["a" + "b"]`: A for assigned, D for defined.
const file = (label: string, imports = "") => `// @ts-nocheck
${imports}{
  let hits = 0;
  class Above {}
  Object.defineProperty(Above.prototype, "y", { set() { hits++; }, configurable: true });
  class Written extends Above { y = 2; optional?: number; }
  class Sum extends Above { ["a" + "b"] = 1; y = 2; optional?: number; }
  const say = (made: object) => { const was = hits ? "A" : "D"; hits = 0; return was; };
  console.log("${label}", say(new Written()) + say(new Sum()));
}
export {};
`;

async function run(cwd: string, ...cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout.trim().split("\n").join(", ");
}

type Answers = { run: string; executable: string; aot: string };
type Project = { entry: string; files: Record<string, string>; beside: Answers; above: Answers };
const projects: Record<string, Project> = {
  "none at the entry, assigned below": {
    entry: ".",
    files: {
      "main.ts": file("entry", 'import "./lib/k.ts";\n'),
      "lib/k.ts": file("below"),
      "lib/tsconfig.json": says(true),
    },
    beside: { run: "below DD, entry DD", executable: "below AD, entry DD", aot: "below AD, entry DD" },
    above: { run: "below DD, entry DD", executable: "below AD, entry DD", aot: "below AD, entry DD" },
  },
  "assigned at the entry, none below": {
    entry: ".",
    files: {
      "main.ts": file("entry", 'import "./lib/k.ts";\n'),
      "lib/k.ts": file("below"),
      "tsconfig.json": says(true),
    },
    beside: { run: "below AA, entry AA", executable: "below AD, entry AD", aot: "below AA, entry AA" },
    above: { run: "below DD, entry DD", executable: "below AD, entry AD", aot: "below AD, entry AD" },
  },
  "assigned at the entry, defined below": {
    entry: ".",
    files: {
      "main.ts": file("entry", 'import "./lib/k.ts";\n'),
      "lib/k.ts": file("below"),
      "tsconfig.json": says(true),
      "lib/tsconfig.json": says(false),
    },
    beside: { run: "below AA, entry AA", executable: "below DD, entry AD", aot: "below DD, entry AA" },
    above: { run: "below DD, entry DD", executable: "below DD, entry AD", aot: "below DD, entry AD" },
  },
  "defined at the entry, assigned below": {
    entry: ".",
    files: {
      "main.ts": file("entry", 'import "./lib/k.ts";\n'),
      "lib/k.ts": file("below"),
      "tsconfig.json": says(false),
      "lib/tsconfig.json": says(true),
    },
    beside: { run: "below DD, entry DD", executable: "below AD, entry DD", aot: "below AD, entry DD" },
    above: { run: "below DD, entry DD", executable: "below AD, entry DD", aot: "below AD, entry DD" },
  },
  "assigned at the root, the entry in a folder": {
    entry: "src",
    files: {
      "src/main.ts": file("entry", 'import "./k.ts";\n'),
      "src/k.ts": file("beside"),
      "tsconfig.json": says(true),
    },
    beside: { run: "beside DD, entry DD", executable: "beside AD, entry AD", aot: "beside AD, entry AD" },
    above: { run: "beside AA, entry AA", executable: "beside AD, entry AD", aot: "beside AA, entry AA" },
  },
  "none at the entry, a package says assigned": {
    entry: ".",
    files: {
      "main.ts": file("entry", 'import "pack";\n'),
      "node_modules/pack/index.ts": file("package"),
      "node_modules/pack/tsconfig.json": says(true),
      "node_modules/pack/package.json": named("pack"),
    },
    beside: { run: "package DD, entry DD", executable: "package AD, entry DD", aot: "package AD, entry DD" },
    above: { run: "package DD, entry DD", executable: "package AD, entry DD", aot: "package AD, entry DD" },
  },
  "assigned at the entry, a package says nothing and one says defined": {
    entry: ".",
    files: {
      "main.ts": file("entry", 'import "pack"; import "other";\n'),
      "tsconfig.json": says(true),
      "node_modules/pack/index.ts": file("silent"),
      "node_modules/pack/package.json": named("pack"),
      "node_modules/other/index.ts": file("defines"),
      "node_modules/other/tsconfig.json": says(false),
      "node_modules/other/package.json": named("other"),
    },
    beside: {
      run: "silent AA, defines AA, entry AA",
      executable: "silent AD, defines DD, entry AD",
      aot: "silent AA, defines DD, entry AA",
    },
    above: {
      run: "silent DD, defines DD, entry DD",
      executable: "silent AD, defines DD, entry AD",
      aot: "silent AD, defines DD, entry AD",
    },
  },
  "assigned in the folder of the entry, a folder beside it says nothing": {
    entry: "app",
    files: {
      "app/main.ts": file("entry", 'import "../shared/k.ts";\n'),
      "app/tsconfig.json": says(true),
      "shared/k.ts": file("sibling"),
    },
    beside: { run: "sibling AA, entry AA", executable: "sibling DD, entry AD", aot: "sibling DD, entry AA" },
    above: { run: "sibling DD, entry DD", executable: "sibling DD, entry AD", aot: "sibling DD, entry AD" },
  },
};

for (const [name, project] of Object.entries(projects)) {
  test(name, async () => {
    using dir = tempDir(
      "class-fields-by-tsconfig",
      Object.fromEntries(Object.entries(project.files).map(([path, text]) => [`project/${path}`, text])),
    );
    const folderOfEntry = join(String(dir), "project", project.entry);
    for (const [place, cwd] of [
      ["beside", folderOfEntry],
      ["above", join(folderOfEntry, "..")],
    ] as const) {
      const entry = join(folderOfEntry, "main.ts");
      const built = async (...flags: string[]) => {
        const executable = join(String(dir), `${place}${flags.join("")}`);
        await run(cwd, bunExe(), "build", "--compile", ...flags, entry, "--outfile", executable);
        return await run(String(dir), executable);
      };
      const answers = { run: await run(cwd, bunExe(), entry), executable: await built(), aot: await built("--aot") };
      expect({ place, ...answers }).toEqual({ place, ...project[place] });
    }
  });
}
