// Research prototype: the inputs of the checks from the reference directory on disk, and the oracle of each.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { buildHarnessFs, newCompilerTest } from "../../instance-materialisation/prototype/compiler_test";
import { enumerateInstances } from "../../instance-materialisation/prototype/enum_runner";
import { materialise, probePlatform, type Platform } from "../../instance-materialisation/prototype/materialize";
import { readFile } from "../../instance-materialisation/prototype/readfile";
import type { CheckInput, CompilerOptionValue, MaterialiseResult } from "./check";
import type { Oracle } from "./run";

export const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
export const libRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/lib";
export const oracleRoot = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";

const harnessNames = new Set([
  "usecasesensitivefilenames", "baselinefile", "includebuiltfile", "filename", "libfiles", "noimplicitreferences",
  "currentdirectory", "symlink", "link", "notypesandsymbols", "fullemitpaths", "reportdiagnostics", "capturesuggestions",
  "typescriptversion",
]);

let libFiles: Map<string, Uint8Array> | undefined;
function testLibFiles(): Map<string, Uint8Array> {
  if (libFiles !== undefined) return libFiles;
  libFiles = new Map();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = dir + "/" + name;
      if (lstatSync(p).isDirectory()) walk(p, rel + "/" + name);
      else libFiles!.set("/.lib" + rel + "/" + name, readFileSync(p));
    }
  };
  walk(libRoot, "");
  return libFiles;
}

export interface Built {
  inputs: CheckInput[];
  skipped: number;
  unsplit: string[];
}

export function oracleOf(input: Pick<CheckInput, "name" | "suite">): Oracle {
  const path = `${oracleRoot}/${input.suite}/${input.name.replace(/\.tsx?$/, "")}.errors.txt`;
  if (!existsSync(path)) return { kind: "C" };
  return { kind: "E", bytes: readFileSync(path), path };
}

export function buildInputs(options: { only?: string; materialiseBelow?: string } = {}): Built {
  const e = enumerateInstances({ casesRoot, only: options.only });
  const cache = new Map<string, string>();
  const inputs: CheckInput[] = [];
  const unsplit: string[] = [];
  let skipped = 0;
  let platform: Platform | undefined;
  let n = 0;
  for (const inst of e.instances) {
    if (inst.status !== "run") {
      skipped++;
      continue;
    }
    const file = casesRoot + "/" + inst.casePath;
    let content = cache.get(file);
    if (content === undefined) {
      content = readFile(file).contents;
      cache.set(file, content);
    }
    const config = inst.config === undefined ? undefined : new Map(inst.config);
    const r = newCompilerTest(content, file, config);
    if (!r.ok) {
      unsplit.push(`${inst.suite}/${inst.name}: ${r.status}: ${r.reason}`);
      continue;
    }
    const t = r.value;
    const configuration: Record<string, string> = {};
    for (const [k, v] of [...(config ?? new Map<string, string>())].sort((a, b) => (a[0] < b[0] ? -1 : 1))) configuration[k] = v;
    const ucsfn = (configuration["usecasesensitivefilenames"] ?? "true").toLowerCase() !== "false";
    const libNames = (configuration["libfiles"] ?? "").split(",").map(s => s.trim()).filter(s => s !== "");
    const noLib = (configuration["nolib"] ?? "").toLowerCase() === "true";
    const fsx = buildHarnessFs(t, { libFiles: libNames, noLib, useCaseSensitiveFileNames: ucsfn });
    // The raw values: the typed form is the work of the port of getOptionValue.
    const compilerOptions: Record<string, CompilerOptionValue> = { noErrorTruncation: true };
    for (const [k, v] of Object.entries(configuration)) if (!harnessNames.has(k)) compilerOptions[k] = v;
    const id = n++;
    inputs.push({
      name: inst.name,
      suite: inst.suite,
      casePath: inst.casePath,
      configuration,
      compilerOptions,
      defaultOptions: { newLine: "crlf", skipDefaultLibCheck: true },
      captureSuggestions: (configuration["capturesuggestions"] ?? "").toLowerCase() === "true",
      useCaseSensitiveFileNames: ucsfn,
      currentDirectory: t.currentDirectory,
      configFile: t.tsConfigFiles.length > 0 ? { name: t.tsConfigFiles[0].unitName, content: t.tsConfigFiles[0].content } : undefined,
      roots: t.toBeCompiled.map(f => ({ name: f.unitName, content: f.content })),
      otherFiles: t.otherFiles.map(f => ({ name: f.unitName, content: f.content })),
      rootNames: fsx.programFileNames,
      links: [...t.symlinks].map(([path, target]) => ({ path, target })),
      includeLibDirectory: fsx.includeLibDir,
      materialise(): MaterialiseResult {
        const below = options.materialiseBelow;
        if (below === undefined) return { ok: false, status: "no-directory", reason: "the run has no directory for instances" };
        mkdirSync(below, { recursive: true });
        platform ??= probePlatform(below + "/.platform");
        const m = materialise(fsx, t.currentDirectory, testLibFiles(), `${below}/${id}`, platform);
        if (!m.ok) return m;
        return { ok: true, value: { ...m.value, rootNames: m.value.roots } };
      },
    });
  }
  return { inputs, skipped, unsplit };
}
