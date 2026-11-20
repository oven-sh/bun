// Whether the fields of a class are assigned or defined is "useDefineForClassFields" in tsconfig.json.
// `bun run` takes it from the tsconfig.json in the working directory, for every file. `bun build --compile` takes it from the one nearest to each file, with --aot too.
// A class with a field under a key that has to be computed defines its fields whatever the option says. `bun run` works out `"a" + "b"`; `bun build` doesn't unless it minifies.
// With --aot the key is worked out where `bun run`, started in the directory of the build, would assign. So no file answers otherwise than both `bun run` and `bun build --compile`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { moreBuildFlags, slot, spawned } from "./harness/commands";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { test } from "./supported";

const says = (assigns: boolean) => JSON.stringify({ compilerOptions: { useDefineForClassFields: !assigns } });
const named = (name: string) => JSON.stringify({ name, main: "index.ts" });
// Prints the label, then what happened to a class with written keys and to one with `["a" + "b"]`.
// A, assigned: `y = 2` called the setter above once, and the object has neither `y` nor `optional` of its own.
// D, defined: the setter was not called, and the object has `y` and `optional` of its own. Anything else is printed as it was seen.
const file = (label: string, imports = "") => `// @ts-nocheck
${imports}{
  let hits = 0;
  class Above {}
  Object.defineProperty(Above.prototype, "y", { set() { hits++; }, configurable: true });
  class Written extends Above { y = 2; optional?: number; }
  class Sum extends Above { ["a" + "b"] = 1; y = 2; optional?: number; }
  const say = (made: object, assigned: string, defined: string) => {
    const seen = hits + " " + Object.keys(made).join();
    hits = 0;
    return seen === "1 " + assigned ? "A" : seen === "0 " + defined ? "D" : "(" + seen + ")";
  };
  console.log("${label}", say(new Written(), "", "y,optional") + say(new Sum(), "ab", "ab,y,optional"));
}
export {};
`;

/** A command that ended by itself, without an error and with nothing on stderr. */
const ended = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null });
/** "below AD, entry DD" stands for the two lines that a program prints. */
const printed = (answer: string) => ended(answer.replaceAll(", ", "\n") + "\n");
/** What a build prints, without what differs from one build to the next: how long each step took, how large the executable is and the ID of the build. */
const rows = (stdout: string, executable: string) =>
  stdout
    .replace(/^ *(?:\[[\d.]+m?s\] +)?/gm, "")
    .replace(executable, "<executable>")
    .replace(/  [\d.]+ MB$/m, "  <size>")
    .replace(/^build id  [0-9a-f]+$/m, "build id  <id>");
/** What a build with --aot writes to stderr: nothing. With AOT_BUILD_FLAGS it takes more flags (harness/commands.ts) and names them there. */
const stderrOfAotBuild = moreBuildFlags.length ? expect.not.stringMatching(/^error\b/m) : "";

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
  test.concurrent(name, async () => {
    using dir = tempDir(
      "class-fields-by-tsconfig",
      Object.fromEntries(Object.entries(project.files).map(([path, text]) => [`project/${path}`, text])),
    );
    const folderOfEntry = join(String(dir), "project", project.entry);
    const entry = join(folderOfEntry, "main.ts");
    // What a build says of the program: it holds every source file, and each of them says `// @ts-nocheck`.
    const sources = Object.entries(project.files)
      .filter(([path]) => path.endsWith(".ts"))
      .map(([, text]) => text);
    const lines = sources.join("").split("\n").length - 1;
    const bundled = `bundle  ${sources.length} modules\n`;
    const checked = `check  ${lines} lines  ${sources.length} files compiled without types\n`;
    const rowsOfBuild = `${bundled}compile  <executable>\n`;
    const rowsOfAotBuild = `${bundled}${checked}compile  <executable>  <size>\nbuild id  <id>\n`;

    const commandsIn = (place: "beside" | "above") => {
      const cwd = place === "beside" ? folderOfEntry : join(folderOfEntry, "..");
      const built = (...flags: string[]) =>
        slot(async () => {
          const executable = join(String(dir), place + flags.join("") + (isWindows ? ".exe" : ""));
          const words = ["build", "--compile", ...flags, ...withoutDebugInformation, entry, "--outfile", executable];
          try {
            const build = await spawned([bunExe(), ...words], cwd, bunEnv);
            return {
              build: { ...build, stdout: rows(build.stdout, executable) },
              start: build.exitCode === 0 ? await spawned([executable], String(dir), bunEnv) : undefined,
            };
          } finally {
            // An executable is the size of Bun, and nothing starts this one again. One that is gone before the system has written it to the disk is never written.
            // Windows may still hold the file of a process that has just ended. There it goes with the folder.
            if (!isWindows) rmSync(executable, { force: true });
          }
        });
      return [slot(() => spawned([bunExe(), entry], cwd, bunEnv)), built(), built("--aot")] as const;
    };
    // The commands of one working directory need nothing of one another, and nothing of those of the other: each starts as soon as a processor is free.
    const started = { beside: commandsIn("beside"), above: commandsIn("above") };
    // The folder stays until the last command has ended, also where one of them threw.
    await Promise.allSettled([...started.beside, ...started.above]);

    for (const place of ["beside", "above"] as const) {
      const [run, executable, aot] = await Promise.all(started[place]);
      expect({ place, run, executable, aot }).toEqual({
        place,
        run: printed(project[place].run),
        executable: { build: ended(rowsOfBuild), start: printed(project[place].executable) },
        aot: { build: { ...ended(rowsOfAotBuild), stderr: stderrOfAotBuild }, start: printed(project[place].aot) },
      });
    }
  });
}
