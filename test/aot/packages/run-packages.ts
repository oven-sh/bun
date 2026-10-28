// Programs that import packages, built with `bun build --compile --aot`.
//
// The packages are written for these tests. Each one copies a way in which real packages on npm are laid out or written: what
// their package.json says ("exports", "imports", "main", "browser", "sideEffects"), how they export (CommonJS as TypeScript, Babel
// and bundlers emit it, UMD, ES modules), what they do when they are loaded (polyfills, patches to Node's modules, cycles,
// top-level await), and declaration files that do not match the code. node_modules is ignored by git, so the files are given
// as strings in ./<topic>.ts and written to a temporary folder.
//
// An importer is a program of a few lines that imports one package in one way: by name, as a namespace, by default, with
// import(), with require(), from JavaScript and from TypeScript. There is one importer per way, because a program that imports
// a package in three ways at once still works when one of the ways is broken.
//
// Every importer has one right answer:
//   nothing stored                        what plain `bun run` prints for the same file, computed on the spot
//   "compiled" in <topic>.answers.json    what `bun build --compile` without --aot prints, where `bun run` and the bundler differ
//                                         (for example, whether the namespace of a CommonJS module has a `default`)
//   { "output": .. }                      the output under --aot where it differs from both on purpose
//   { "errors": .. }                      the build must fail with exit code 1 and exactly these `error:` lines
// A case with stored output or errors says why in `differs`.
//
//   bun test test/aot/packages                            one importer in ten, others for each commit of Bun, and at least one of
//                                                         every case (about 8 minutes of CPU time)
//   AOT_PROGRAMS=quick bun test test/aot/packages         the same, the same ones every time
//   AOT_PROGRAMS= bun test test/aot/packages              every importer (about 35 minutes of CPU time)
//   AOT_PROGRAMS=umd bun test test/aot/packages           the importers whose name contains the text
//   AOT_PROGRAMS_JOBS=4 bun test ..                       how many importers run at once (default: one per core)
//   AOT_PROGRAMS_UPDATE=1 AOT_PROGRAMS= bun test ..       rewrites <topic>.answers.json
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { dirname, join } from "path";
import { built, inShareOfList, slot, spawned, takesWhatIsFixed, told, unsupported } from "../run-programs";

export interface Case {
  name: string;
  /** Paths are relative to the folder that all cases of a topic share. */
  files: Record<string, string>;
  /** Symbolic links: where the link is, and what it points to. */
  links?: Record<string, string>;
  /** File name and text. In the folder the file is called <case>.<file name>. */
  importers: Record<string, string>;
  /** Why some importers of this case have stored output or build errors. */
  differs?: string;
  /** Plain `bun run` itself ends with an error for some importer of this case, and that is what is tested. */
  fails?: true;
}

type Answer = "compiled" | { output: string } | { errors: string };

// Every importer of every case takes as long as all the rest of test/aot.
const wanted = process.env.AOT_PROGRAMS ?? "quick";
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

const tsconfig = {
  compilerOptions: {
    strict: true,
    module: "preserve",
    moduleResolution: "bundler",
    target: "esnext",
    types: ["bun"],
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    allowArbitraryExtensions: true,
  },
};

let executables = 0;

/** Defines one test per importer. A large topic is split into `parts` by a hash of the name. */
/** The cases of ./<topic>.ts, which may also say what else stands in the package.json of the program. */
export function packages(topic: string, part = 1, parts = 1) {
  const { cases, root = {} }: { cases: Case[]; root?: Record<string, unknown> } = require(`./${topic}`);
  const stored = join(import.meta.dir, topic + ".answers.json");
  const answers: Record<string, Answer> = existsSync(stored) ? JSON.parse(readFileSync(stored, "utf8")) : {};
  const hash = (name: string) => BigInt(Bun.hash(topic + "/" + name));
  const all = cases.flatMap(each => Object.keys(each.importers).map(file => ({ each, file: `${each.name}.${file}` })));
  const isTenth = (file: string) => inShareOfList(`${topic}/${file}`, Number((hash(file) >> 8n) % 10n));
  // Of a case that has no importer in the tenth, the one with the smallest hash.
  const first = new Map<Case, string>();
  for (const { each, file } of all) if (!first.has(each) || hash(file) < hash(first.get(each)!)) first.set(each, file);
  for (const { each, file } of all) if (isTenth(file)) first.delete(each);
  const chosen = all
    .filter(({ file }) => Number(hash(file) % BigInt(parts)) === part - 1)
    .filter(({ each, file }) => (wanted === "quick" ? isTenth(file) || (takesWhatIsFixed && first.get(each) === file) : file.includes(wanted)));

  const folder = String(tempDirWithBunTypes("aot-packages", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  };
  write("package.json", JSON.stringify({ name: "program", version: "1.0.0", ...root }));
  write("tsconfig.json", JSON.stringify(tsconfig));
  for (const each of cases) {
    for (const [path, text] of Object.entries(each.files)) write(path, text);
    for (const [path, target] of Object.entries(each.links ?? {})) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      symlinkSync(target, join(folder, path), "junction");
    }
    for (const [file, text] of Object.entries(each.importers)) write(`${each.name}.${file}`, text);
  }

  // Paths differ between the sources and an executable, which has its files under a root of its own.
  const withoutPaths = (text: string) =>
    [folder, "B:\\~BUN\\root"]
      .flatMap(root => [root, JSON.stringify(root).slice(1, -1), root.replaceAll("\\", "/")])
      .reduce((tidied, root) => tidied.replaceAll(root, "<folder>"), text.replaceAll("/private" + folder, "<folder>").replaceAll("/$bunfs/root", "<folder>"))
      .replace(/<folder>\\[^\s:"'`]*/g, path => path.replace(/\\+/g, "/"));
  const result = (run: { stdout: string; stderr: string; exitCode: number }) => {
    const { stdout, stderr, exitCode } = told({ ...run, stdout: withoutPaths(run.stdout), stderr: withoutPaths(run.stderr) });
    return stdout + (exitCode ? `exit code ${exitCode}\n${stderr}\n` : stderr);
  };

  async function run(each: Case, file: string) {
    const executable = join(folder, `program-${executables++}${isWindows ? ".exe" : ""}`);
    const answer = answers[file];
    const plain = async () => {
      const ran = await spawned([bunExe(), "run", file], folder, bunEnv);
      // Two runs that die of the same accident would compare equal.
      if (!each.fails) expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      return result(ran);
    };
    const compiled = async () => {
      built(await spawned([bunExe(), "build", "--compile", file, "--outfile", executable], folder, bunEnv));
      return result(await spawned([executable], folder, bunEnv));
    };
    try {
      const build = await spawned([bunExe(), "build", "--compile", "--aot", file, "--outfile", executable], folder, bunEnv);
      if (build.exitCode !== 0 && (updates || (typeof answer === "object" && "errors" in answer))) {
        // Each distinct error counts once; how often it is repeated for different positions is not what is tested.
        const errors = [...new Set(withoutPaths(build.stderr).split("\n").filter(line => line.startsWith("error: ")))].join("\n") + "\n";
        if (updates) return void (answers[file] = { errors });
        expect({ errors, exitCode: build.exitCode }).toEqual({ errors: (answer as { errors: string }).errors, exitCode: 1 });
        return;
      }
      built(build);
      const ran = await spawned([executable], folder, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
      expect({ signal: ran.signal, stderr: ran.signal ? ran.stderr : "" }).toEqual({ signal: null, stderr: "" });
      // The executable really ran compiled code and did not fall back to the embedded source.
      expect(ran.stderr).toContain("[aot] module: ");
      const output = result({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\r?\n/gm, "") });

      if (updates) {
        if (output === (await plain())) delete answers[file];
        else if (output === (await compiled().catch(() => null))) answers[file] = "compiled";
        else answers[file] = { output };
        return;
      }
      if (answer === undefined) expect(output).toBe(await plain());
      else if (answer === "compiled") expect(output).toBe(await compiled());
      else expect({ output }).toEqual(answer as { output: string });
    } finally {
      rmSync(executable, { force: true });
    }
  }

  describe.concurrent(`compile/aot/packages/${topic}`, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    // A filter can leave a test file without any importer.
    if (chosen.length === 0) test.skip("no importer selected", () => {});
    // The child processes have their own time limits; this one also covers the wait for a free slot.
    for (const { each, file } of chosen) test(file, () => slot(() => run(each, file)), 600_000);
  });

  test(`compile/aot/packages/${topic}: a case with stored output says why`, () => {
    const silent = all.filter(({ each, file }) => typeof answers[file] === "object" && !each.differs).map(({ file }) => file);
    expect(silent).toEqual([]);
    // And a reason is given only where something is stored.
    if (cases.some(each => each.differs)) expect(Object.values(answers).filter(answer => typeof answer === "object")).not.toBeEmpty();
  });

  test(`compile/aot/packages/${topic}: every stored answer belongs to an importer`, () => {
    const files = new Set(all.map(({ file }) => file));
    expect(Object.keys(answers).filter(file => !files.has(file))).toEqual([]);
  });

  if (updates) {
    afterAll(() => {
      const files = new Set(all.map(({ file }) => file));
      const sorted = Object.fromEntries(Object.entries(answers).filter(([file]) => files.has(file)).sort(([a], [b]) => (a < b ? -1 : 1)));
      if (Object.keys(sorted).length) writeFileSync(stored, JSON.stringify(sorted, null, 2) + "\n");
      else rmSync(stored, { force: true });
    });
  }
}

// What the importers print with. `show` makes every kind of value visible in one line; `t` prints what a function returns or
// the name of what it throws. A TypeError that --aot itself throws is printed with its message, which ends in a link to the docs.
export const js = `const show = (v) => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k, x) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e) => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0].slice(0, 110) + "]" : "");
const t = (name, f) => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name, f) => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o) => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
`;
export const ts = `const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
`;

/** The files of a package under node_modules: what is given, and its package.json. */
export function pkg(name: string, files: Record<string, string>, packageJson: Record<string, unknown> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`node_modules/${name}/${path}`, text])),
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", ...packageJson }, null, 1),
  };
}

/** One importer for each way of importing `specifier`. `names` is what it exports by name. */
export function ways(
  specifier: string,
  names: string[],
  { tag = specifier.replace(/[/.]/g, "_").replace("#", "h_").replace("@", ""), hasDefault = true, typed = true, required = true, only = undefined as string[] | undefined } = {},
): Record<string, string> {
  const renamed = names.map(n => `${n} as n_${n}`).join(", ");
  const probes = names.map(n => `t("${n}", () => n_${n});`).join(" ");
  const members = (of: string, which = names) => which.map(n => `t("${n}", () => ${of}.${n});`).join(" ");
  const all: Record<string, string> = {};
  if (names.length) {
    all["names.mjs"] = `import { ${renamed} } from "${specifier}";\n${js}${probes}\n`;
    all["later.mjs"] = `import { ${names.at(-1)} as n } from "${specifier}";\n${js}function later() { return show(n); }\nconsole.log("start");\nconsole.log(later(), later());\n`;
  }
  all["namespace.mjs"] = `import * as ns from "${specifier}";\n${js}console.log(keys(ns));\n${members("ns")}\n`;
  all["dynamic-import.mjs"] = `${js}const ns = await import("${specifier}");\nconsole.log(keys(ns));\n${members("ns", hasDefault ? [...names, "default"] : names)}\n`;
  if (hasDefault) all["default.mjs"] = `import d from "${specifier}";\n${js}t("default", () => d);\nt("keys", () => (typeof d === "object" && d !== null) || typeof d === "function" ? keys(d) : "");\n`;
  if (required) {
    all["require.cjs"] = `${js}const whole = require("${specifier}");\nt("whole", () => typeof whole + " " + keys(whole));\n${members("whole")}\n`;
    if (names.length) all["require-destructured.cjs"] = `${js}const { ${names.map(n => `${n}: n_${n}`).join(", ")} } = require("${specifier}");\n${probes}\n`;
  }
  if (typed) {
    if (names.length) all["names.ts"] = `import { ${renamed} } from "${specifier}";\n${ts}${probes}\n`;
    all["namespace.ts"] = `import * as ns from "${specifier}";\n${ts}console.log(keys(ns));\n${members("ns")}\n`;
    if (hasDefault) all["default.ts"] = `import d from "${specifier}";\n${ts}t("default", () => d);\n`;
    all["dynamic-import.ts"] = `${ts}const ns = await import("${specifier}");\nconsole.log(keys(ns));\n${members("ns")}\nexport {};\n`;
  }
  return Object.fromEntries(Object.entries(all).filter(([file]) => !only || only.includes(file)).map(([file, text]) => [`${tag}.${file}`, text]));
}

/**
 * A CommonJS package twice: as it is, which makes it sloppy-mode code as under `bun run`, and under "use strict", as TypeScript
 * and Babel emit it. The package sets `exports.ok`, and the importer prints it.
 */
export function inBothModes(name: string, packageName: string, files: Record<string, string>, { differs = undefined as string | undefined, required = false } = {}): Case[] {
  return [
    ["sloppy", ""],
    ["strict", '"use strict";\n'],
  ].map(([mode, head]) => ({
    name: `${name}-${mode}`,
    differs,
    files: pkg(`${packageName}_${mode}`, { ...files, "index.js": head + files["index.js"] }, { main: "index.js" }),
    importers: {
      "import.mjs": `import w from "${packageName}_${mode}";\n${js}t("ok", () => w.ok);\n`,
      // Inside a function, so that the compiler cannot tell whether the package is ever loaded.
      ...(required ? { "require.cjs": `${js}t("ok", () => require("${packageName}_${mode}").ok);\n` } : {}),
    },
  }));
}
