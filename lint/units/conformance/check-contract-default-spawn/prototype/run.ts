// Prototype of the pipeline: input of an instance, check, baseline text, comparison with the oracle bytes.
import { existsSync, readFileSync } from "node:fs";
import { type Check, type CheckDiagnostic, type CheckInput, type CheckMessageChain, type CheckResult, type CheckUnit, type ComparisonLevel, type PlainCheckDiagnostic, failure, materialise } from "./check";
import { type PlainChain, writePlainDiagnostic } from "./plain_format";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const E = new URL("../../error-baseline-format/top-down/", import.meta.url).pathname;
const { makeUnitsFromTest, srcFolder } = await import(P + "test_case_parser.ts");
const { getNormalizedAbsolutePath } = await import(P + "tspath.ts");
const { tsgoRules, categoryName, categoryFromName, WriterPanic } = await import(E + "diagnosticwriter.ts");
const { getErrorBaseline, removeTestPathPrefixes } = await import(E + "error_baseline.ts");
const { readErrorBaseline } = await import(E + "reader.ts");

export const rules = tsgoRules;
const testLibRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/lib";
const testLibCache = new Map<string, string | undefined>();
// content of a file of the folder /.lib/ of the harness, undefined when there is none
export function testLibFile(virtualName: string): string | undefined {
  if (!virtualName.startsWith("/.lib/")) return undefined;
  if (!testLibCache.has(virtualName)) {
    const path = testLibRoot + virtualName.slice("/.lib".length);
    testLibCache.set(virtualName, existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : undefined);
  }
  return testLibCache.get(virtualName);
}
const model = rules.model;
const requireStr = "require(";
const referencesRegex = /reference[\t\n\f\r ]path/;
const libPrefix = /(?<![^\n])([lL][iI][bB][^\n]*\.[dD]\.[tT](?:[sS]|\xc5\xbf))\(\d+,\d+\)/g;

export type Status = "pass" | "fail" | "provisional" | "error" | "unsupported";

export interface RunResult {
  name: string;
  kind: "E" | "C";
  level: ComparisonLevel;
  status: Status;
  detail: string;
  // in the text model of the rules; undefined when nothing was written
  actual: string | undefined;
  expected: string | undefined;
}

export interface InstanceLike {
  name: string;
  suite: string;
  casePath: string;
  config: Map<string, string> | undefined;
}

// compiler_runner.go newCompilerTest up to the call of CompileFiles; undefined when the case has a configuration unit
export function buildInput(instance: InstanceLike, content: string, fileName: string): (CheckInput & { dispose(): void }) | string {
  const made = makeUnitsFromTest(content, fileName);
  if (!made.ok) return made.reason;
  const t = made.value;
  const config = instance.config;
  const currentDirectory: string = getNormalizedAbsolutePath(config?.get("currentdirectory") ?? "", srcFolder);
  const unit = (u: { name: string; content: string }): CheckUnit => ({ name: getNormalizedAbsolutePath(u.name, currentDirectory), content: u.content });
  if (t.tsConfigFileUnitData !== undefined) return "the file list of a configuration unit is not modelled";
  const units = t.testUnitData;
  const last = units[units.length - 1];
  let roots: CheckUnit[];
  let otherFiles: CheckUnit[] = [];
  if ((config?.get("noimplicitreferences") ?? "") !== "" || last.content.includes(requireStr) || referencesRegex.test(last.content)) {
    roots = [unit(last)];
    otherFiles = units.slice(0, -1).map(unit);
  } else {
    roots = units.map(unit);
  }
  const links = new Map<string, string>();
  for (const [link, target] of t.symlinks) links.set(getNormalizedAbsolutePath(link, currentDirectory), getNormalizedAbsolutePath(target, currentDirectory));
  const programFileNames = roots.map(u => u.name).filter(n => !n.endsWith(".json") && !n.endsWith(".tsbuildinfo"));
  const useCaseSensitiveFileNames = (config?.get("usecasesensitivefilenames") ?? "true").toLowerCase() !== "false";
  const pretty = (config?.get("pretty") ?? "").toLowerCase() === "true";
  const base = { name: instance.name, config, currentDirectory, configFile: undefined, roots, otherFiles, links, programFileNames, useCaseSensitiveFileNames, pretty };
  let m: ReturnType<typeof materialise> | undefined;
  return { ...base, materialise: () => (m ??= materialise(base)), dispose: () => m?.dispose() };
}

export function sectionFiles(input: CheckInput): { unitName: string; content: string }[] {
  const files = [...(input.configFile ? [input.configFile] : []), ...input.roots, ...input.otherFiles];
  return files.map(f => ({ unitName: model.fromString(f.name), content: model.fromString(f.content) }));
}

export function firstSectionOf(oracle: string): string | undefined {
  if (oracle.startsWith("\x1b[")) return undefined;
  const end = oracle.indexOf("\r\n\r\n\r\n");
  return end < 0 ? undefined : oracle.slice(0, end + 2);
}

export function writeFirstSection(diagnostics: PlainCheckDiagnostic[]): string {
  let out = "";
  for (const d of diagnostics) {
    out += writePlainDiagnostic({ ...d, path: d.file, codeText: "TS" + d.code, stderrLine: 0 }, d.file, "\r\n");
  }
  return removeTestPathPrefixes(rules, model.fromString(out)).replace(libPrefix, "$1(--,--)");
}

function utf8Offset(content: string, utf16Offset: number): number {
  return Buffer.byteLength(content.slice(0, utf16Offset), "utf8");
}

export function toWriterDiagnostics(input: CheckInput, result: Extract<CheckResult, { kind: "diagnostics" }>): any[] {
  const files = new Map<string, { fileName: string; text: string; source: string | undefined }>();
  for (const f of [...(input.configFile ? [input.configFile] : []), ...input.roots, ...input.otherFiles]) {
    files.set(f.name, { fileName: model.fromString(f.name), text: model.fromString(f.content), source: f.content });
  }
  const fileOf = (name: string | undefined, end: number) => {
    if (name === undefined) return undefined;
    let f = files.get(name);
    if (f === undefined && testLibFile(name) !== undefined) {
      const source = testLibFile(name)!;
      f = { fileName: model.fromString(name), text: model.fromString(source), source };
      files.set(name, f);
    }
    if (f === undefined) {
      // a file that is no unit: its text is not known, positions print masked or not at all
      f = { fileName: model.fromString(name), text: " ".repeat(end + 1), source: undefined };
      files.set(name, f);
    } else if (f.source === undefined && f.text.length <= end) {
      f.text = " ".repeat(end + 1);
    }
    return f;
  };
  const chain = (c: CheckMessageChain): any => ({
    file: undefined,
    pos: -1,
    end: -1,
    code: c.code ?? 0,
    category: categoryFromName(c.category ?? "message"),
    messageText: model.fromString(c.messageText),
    messageChain: c.messageChain.map(chain),
    relatedInformation: [],
  });
  const located = (d: CheckDiagnostic | CheckDiagnostic["relatedInformation"][number]): any => {
    let pos = d.start;
    let end = d.start + d.length;
    if (d.file !== undefined && result.positions === "utf16") {
      const source = files.get(d.file)?.source ?? testLibFile(d.file);
      if (source !== undefined) {
        pos = utf8Offset(source, pos);
        end = utf8Offset(source, end);
      }
    }
    const file = fileOf(d.file, end);
    return { ...chain(d), file, pos: file === undefined ? d.start : pos, end: file === undefined ? d.start + d.length : end };
  };
  return result.diagnostics.map(d => ({ ...located(d), relatedInformation: d.relatedInformation.map(located) }));
}

export function evaluate(input: CheckInput, check: Pick<Check, "level">, result: CheckResult, oracle: string | undefined, pretty: boolean): RunResult {
  const kind = oracle === undefined ? "C" : "E";
  const base = { name: input.name, kind, level: check.level, actual: undefined, expected: undefined } as const;
  if (result.kind === "failure") {
    return { ...base, status: result.failure === "unsupported" ? "unsupported" : "error", detail: `${result.failure}: ${result.detail}` };
  }
  if ((result.kind === "plain") !== (check.level === "first-section")) {
    return { ...base, status: "error", detail: `a check of level ${check.level} returned a result of kind ${result.kind}` };
  }
  if (result.provisional.length > 0) {
    return { ...base, status: "provisional", detail: "stand-ins: " + [...new Set(result.provisional)].sort().join(", ") };
  }
  let expected: string | undefined;
  let actual: string | undefined;
  if (result.kind === "plain") {
    if (oracle !== undefined) {
      expected = firstSectionOf(oracle);
      if (expected === undefined) return { ...base, status: "unsupported", detail: "the oracle has the pretty form: it has no first section in the plain format" };
    }
    actual = result.diagnostics.length > 0 ? writeFirstSection(result.diagnostics) : undefined;
  } else {
    expected = oracle;
    if (result.diagnostics.length > 0) {
      try {
        const written = getErrorBaseline(rules, sectionFiles(input), toWriterDiagnostics(input, result), pretty);
        if (written.failedChecks.length > 0) return { ...base, status: "error", detail: "writer: " + written.failedChecks.join("; "), actual: written.text, expected };
        actual = written.text;
      } catch (e) {
        if (e instanceof WriterPanic) return { ...base, status: "error", detail: "writer: " + e.message, expected };
        throw e;
      }
    }
  }
  // error_baseline.go:44: a diagnostic with code -1 records a broken assertion and fails the test after the comparison
  if (result.diagnostics.some(d => d.code === -1)) return { ...base, status: "error", detail: "diagnostic with code -1", actual, expected };
  if (actual === expected) return { ...base, status: "pass", detail: "", actual, expected };
  return { ...base, status: "fail", detail: firstDifference(expected, actual), actual, expected };
}

export function firstDifference(expected: string | undefined, actual: string | undefined): string {
  if (expected === undefined) return "expected no diagnostic, got:\n" + model.toString(actual!).split("\r\n").slice(0, 5).join("\n");
  if (actual === undefined) return "expected diagnostics, got none; first expected line:\n" + model.toString(expected).split("\r\n")[0];
  const a = expected.split("\r\n");
  const b = actual.split("\r\n");
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return `line ${k + 1}:\n- ${k < a.length ? model.toString(a[k]) : "<end>"}\n+ ${k < b.length ? model.toString(b[k]) : "<end>"}`;
}

export async function runInstance(input: CheckInput, check: Check, oracle: string | undefined, pretty: boolean): Promise<RunResult> {
  let result: CheckResult;
  try {
    result = await check.check(input);
  } catch (e) {
    result = failure("thrown", String((e as Error)?.stack ?? e));
  }
  return evaluate(input, check, result, oracle, pretty);
}

// ---- checks for the tests of the pipeline ----

export function replayCheck(oracleOf: (name: string) => string | undefined): Check {
  return {
    name: "replay",
    level: "baseline",
    async check(input) {
      const text = oracleOf(input.name);
      if (text === undefined) return { kind: "diagnostics", positions: "utf8", diagnostics: [], provisional: [] };
      const parsed = readErrorBaseline(rules, text, { units: sectionFiles(input) });
      const unitNames = new Set(sectionFiles(input).map(f => model.toString(f.unitName)));
      const chain = (d: any): CheckMessageChain => ({ code: d.code, category: categoryName(d.category), messageText: model.toString(d.messageText), messageChain: d.messageChain.map(chain) });
      const located = (d: any) => {
        if (d.file === undefined) return { ...chain(d), file: undefined, start: d.pos, length: d.end - d.pos };
        let file: string = model.toString(d.file.fileName);
        let start = d.pos;
        if (!unitNames.has(file) && file.startsWith("/.src/")) {
          const inLib = "/.lib/" + file.slice("/.src/".length);
          const source = testLibFile(inLib);
          if (source !== undefined) {
            // the reader knows line and column of a file that is no unit, not its text
            const starts = (d.file.lineMap ??= model.lineStarts(d.file.text));
            let l = 0;
            while (l + 1 < starts.length && starts[l + 1] <= d.pos) l++;
            const column = model.utf16Length(d.file.text, starts[l], d.pos);
            const real = model.fromString(source);
            const realStarts = model.lineStarts(real);
            start = model.advanceUTF16(real, realStarts[l], column, real.length)!;
            file = inLib;
          }
        }
        return { ...chain(d), file, start, length: d.end - d.pos };
      };
      return {
        kind: "diagnostics",
        positions: "utf8",
        diagnostics: parsed.diagnostics.map((d: any) => ({ ...located(d), relatedInformation: d.relatedInformation.map(located) })),
        provisional: [],
      };
    },
  };
}

export function replayPlainCheck(oracleOf: (name: string) => string | undefined): Check {
  return {
    name: "replay-plain",
    level: "first-section",
    async check(input) {
      const text = oracleOf(input.name);
      if (text === undefined) return { kind: "plain", diagnostics: [], provisional: [], ignoredRuleDiagnostics: 0 };
      const parsed = readErrorBaseline(rules, text, { units: sectionFiles(input) });
      const chain = (d: any): PlainChain => ({ messageText: model.toString(d.messageText), messageChain: d.messageChain.map(chain) });
      const diagnostics: PlainCheckDiagnostic[] = parsed.diagnostics.map((d: any) => {
        let line = 0, column = 0;
        if (d.file !== undefined) {
          const starts = (d.file.lineMap ??= model.lineStarts(d.file.text));
          let l = 0;
          while (l + 1 < starts.length && starts[l + 1] <= d.pos) l++;
          line = l + 1;
          column = model.utf16Length(d.file.text, starts[l], d.pos) + 1;
        }
        return { file: d.file === undefined ? undefined : model.toString(d.file.fileName), line, column, category: categoryName(d.category), code: d.code, messageText: model.toString(d.messageText), messageChain: d.messageChain.map(chain) };
      });
      return { kind: "plain", diagnostics, provisional: [], ignoredRuleDiagnostics: 0 };
    },
  };
}

export function emptyCheck(level: ComparisonLevel): Check {
  return {
    name: "empty",
    level,
    async check() {
      return level === "baseline" ? { kind: "diagnostics", positions: "utf8", diagnostics: [], provisional: [] } : { kind: "plain", diagnostics: [], provisional: [], ignoredRuleDiagnostics: 0 };
    },
  };
}

export function readOracle(baselines: string, instance: InstanceLike): string | undefined {
  const path = baselines + "/" + instance.suite + "/" + instance.name.replace(/\.tsx?$/, ".errors.txt");
  return existsSync(path) ? model.fromBytes(readFileSync(path)) : undefined;
}
