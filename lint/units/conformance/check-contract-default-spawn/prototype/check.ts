// Prototype of the check contract and of the default check that spawns a command line.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { type CategoryName, type PlainChain, parsePlainDiagnostics } from "./plain_format";

export type ComparisonLevel = "baseline" | "first-section";

export interface CheckUnit {
  // absolute virtual name: GetNormalizedAbsolutePath(unit name, current directory)
  name: string;
  content: string;
}

export interface CheckInput {
  // configured name of the instance, the stem of its baseline
  name: string;
  // lowercased option names with one value each; undefined when the case has no option at all
  config: ReadonlyMap<string, string> | undefined;
  currentDirectory: string;
  // the configuration unit, the roots and the other files, in the order of the sections of a baseline
  configFile: CheckUnit | undefined;
  roots: readonly CheckUnit[];
  otherFiles: readonly CheckUnit[];
  // link name to target, both absolute virtual names
  links: ReadonlyMap<string, string>;
  // the roots that make the program: no .json, no .tsbuildinfo
  programFileNames: readonly string[];
  useCaseSensitiveFileNames: boolean;
  pretty: boolean;
  materialise(): Materialised;
}

// The shape of the materialisation module: the names are the ones of its prototype.
export interface Materialised {
  // real directory that stands for the virtual root "/"
  root: string;
  // real current directory, it exists
  currentDirectory: string;
  // real paths of the program file names, in order
  roots: string[];
  toReal(virtualName: string): string;
  // undefined for a path outside the root
  toVirtual(realPath: string): string | undefined;
  // every occurrence of the real root in a text becomes the virtual name
  mapText(text: string): string;
}

export interface CheckMessageChain {
  // a baseline prints neither of the two for an entry of a chain
  code?: number;
  category?: CategoryName;
  messageText: string;
  messageChain: CheckMessageChain[];
}

export interface CheckRelatedInformation extends CheckMessageChain {
  code: number;
  file: string | undefined;
  start: number;
  length: number;
}

export interface CheckDiagnostic extends CheckRelatedInformation {
  category: CategoryName;
  relatedInformation: CheckRelatedInformation[];
}

export interface PlainCheckDiagnostic {
  file: string | undefined;
  line: number;
  column: number;
  category: CategoryName;
  code: number;
  messageText: string;
  messageChain: PlainChain[];
}

export type FailureKind =
  | "probe"
  | "unsupported"
  | "spawn"
  | "timeout"
  | "signal"
  | "exit-code"
  | "refused"
  | "stdout"
  | "stderr"
  | "exit-mismatch"
  | "path"
  | "internal"
  | "thrown";

export interface CheckFailure {
  kind: "failure";
  failure: FailureKind;
  detail: string;
  exitCode?: number | null;
  signal?: string | number | null;
  stderr?: string;
}

export type CheckResult =
  | { kind: "diagnostics"; positions: "utf8" | "utf16"; diagnostics: CheckDiagnostic[]; provisional: string[] }
  | { kind: "plain"; diagnostics: PlainCheckDiagnostic[]; provisional: string[]; ignoredRuleDiagnostics: number }
  | CheckFailure;

export interface Check {
  readonly name: string;
  readonly level: ComparisonLevel;
  check(input: CheckInput): Promise<CheckResult>;
  checkBatch?(inputs: readonly CheckInput[]): Promise<CheckResult[]>;
  close?(): Promise<void>;
}

export function failure(kind: FailureKind, detail: string, more: Partial<CheckFailure> = {}): CheckFailure {
  return { kind: "failure", failure: kind, detail, ...more };
}

// ---- materialisation ----

export function materialise(input: Omit<CheckInput, "materialise">, parent = realpathSync.native(tmpdir())): Materialised & { dispose(): void } {
  const root = mkdtempSync(join(parent, "lint-conformance-"));
  const toReal = (virtualName: string) => {
    if (!virtualName.startsWith("/")) throw new Error(`not a POSIX virtual name: ${virtualName}`);
    return root + virtualName;
  };
  const files = [...(input.configFile ? [input.configFile] : []), ...input.roots, ...input.otherFiles];
  for (const unit of files) {
    const path = toReal(unit.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, unit.content);
  }
  for (const [link, target] of input.links) {
    const path = toReal(link);
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(toReal(target), path);
  }
  const currentDirectory = toReal(input.currentDirectory);
  mkdirSync(currentDirectory, { recursive: true });
  return {
    root,
    currentDirectory,
    roots: input.programFileNames.map(toReal),
    toReal,
    toVirtual(path) {
      if (path === root) return "/";
      return path.startsWith(root + "/") ? path.slice(root.length) : undefined;
    },
    mapText: text => text.replaceAll(root, ""),
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---- the default check ----

export const lintFlag = "--lint";
export const lintFeatureVariable = "BUN_FEATURE_FLAG_EXPERIMENTAL_LINT";
export const standInCode = "internal-stand-in";
export const internalErrorCode = "internal-error";

export interface SpawnCheckOptions {
  // the command without --lint and without operands
  command: readonly string[];
  // the environment of the child; the feature variable is added
  env: Record<string, string | undefined>;
  // limit of one instance, default 60 s
  timeoutMs?: number;
  // limit of one run of the probe, default 60 s
  probeTimeoutMs?: number;
  name?: string;
}

export interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | number | null;
  timedOut: boolean;
  spawnError: string | undefined;
}

export async function spawnLint(options: SpawnCheckOptions, operands: readonly string[], cwd: string, timeout = options.timeoutMs ?? 60_000): Promise<SpawnOutcome> {
  const started = performance.now();
  let proc;
  try {
    proc = Bun.spawn({
      cmd: [...options.command, lintFlag, ...operands],
      cwd,
      env: { ...options.env, [lintFeatureVariable]: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout,
      killSignal: "SIGKILL",
    });
  } catch (e) {
    return { stdout: "", stderr: "", exitCode: null, signal: null, timedOut: false, spawnError: String((e as Error)?.message ?? e) };
  }
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const signal = proc.signalCode;
  const timedOut = signal === "SIGKILL" && performance.now() - started >= timeout;
  return { stdout, stderr, exitCode: proc.exitCode, signal, timedOut, spawnError: undefined };
}

const libraryFile = /^lib\..*\.d\.ts$/;

export function interpret(outcome: SpawnOutcome, m: Pick<Materialised, "currentDirectory" | "toVirtual" | "mapText">, libraryRoot: string): CheckResult {
  const more = { exitCode: outcome.exitCode, signal: outcome.signal, stderr: outcome.stderr };
  if (outcome.spawnError !== undefined) return failure("spawn", outcome.spawnError);
  if (outcome.timedOut) return failure("timeout", "killed after the time limit", more);
  if (outcome.signal !== null) return failure("signal", `ended by signal ${outcome.signal}`, more);
  if (outcome.stdout.length > 0) return failure("stdout", `a lint run prints nothing on stdout, got ${JSON.stringify(outcome.stdout.slice(0, 200))}`, more);
  if (outcome.exitCode === 1) return failure("refused", "exit code 1: the command refused the run", more);
  if (outcome.exitCode !== 0 && outcome.exitCode !== 2) return failure("exit-code", `exit code ${outcome.exitCode}`, more);
  const parsed = parsePlainDiagnostics(outcome.stderr);
  if (!parsed.ok) return failure("stderr", `stderr line ${parsed.stderrLine}: ${parsed.reason}: ${JSON.stringify(parsed.text.slice(0, 200))}`, more);
  const hasError = parsed.diagnostics.some(d => d.category === "error");
  if (outcome.exitCode === 0 && hasError) return failure("exit-mismatch", "exit code 0 with a diagnostic of category error", more);
  if (outcome.exitCode === 2 && !hasError) return failure("exit-mismatch", "exit code 2 without a diagnostic of category error", more);

  const diagnostics: PlainCheckDiagnostic[] = [];
  const provisional: string[] = [];
  let ignoredRuleDiagnostics = 0;
  const mapText = m.mapText;
  const mapChain = (chain: PlainChain[]): PlainChain[] => chain.map(c => ({ messageText: mapText(c.messageText), messageChain: mapChain(c.messageChain) }));
  for (const d of parsed.diagnostics) {
    if (d.codeText === standInCode) {
      provisional.push(d.messageText);
      continue;
    }
    if (d.codeText === internalErrorCode) return failure("internal", d.messageText, more);
    if (d.code === undefined) {
      ignoredRuleDiagnostics++;
      continue;
    }
    let file: string | undefined;
    if (d.path !== undefined) {
      const printed = sep === "\\" ? d.path.replaceAll("\\", "/") : d.path;
      const real = isAbsolute(printed) ? resolve(printed) : resolve(m.currentDirectory, printed);
      file = m.toVirtual(real);
      if (file === undefined) {
        const base = real.slice(real.lastIndexOf(sep) + 1);
        if (!libraryFile.test(base)) return failure("path", `stderr line ${d.stderrLine}: ${d.path} is no file of the instance and no library file`, more);
        file = libraryRoot + base;
      }
    }
    diagnostics.push({ file, line: d.line, column: d.column, category: d.category, code: d.code, messageText: mapText(d.messageText), messageChain: mapChain(d.messageChain) });
  }
  return { kind: "plain", diagnostics, provisional, ignoredRuleDiagnostics };
}

// ---- the probe ----

export const probeMarker = "lint-conformance-probe-was-executed";
export const probeClean = `export {};\ndeclare const console: { log(text: string): void };\nconsole.log("${probeMarker}");\n`;
export const probeError = `export {};\nconst x: number = "s";\n`;
export const probeExpected: PlainCheckDiagnostic = {
  file: "/error.ts",
  line: 2,
  column: 7,
  category: "error",
  code: 2322,
  messageText: "Type 'string' is not assignable to type 'number'.",
  messageChain: [],
};

export type ProbeVerdict = { ok: true } | { ok: false; reason: "executes-operand" | "clean-file" | "error-file"; detail: string };

// Two runs on files that do nothing when a command runs them: the command must not run an operand and must check.
export async function probe(options: SpawnCheckOptions, libraryRoot = "bundled:///libs/"): Promise<ProbeVerdict> {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), "lint-conformance-probe-"));
  try {
    writeFileSync(join(root, "clean.ts"), probeClean);
    writeFileSync(join(root, "error.ts"), probeError);
    const m = {
      currentDirectory: root,
      toVirtual: (path: string) => (path.startsWith(root + "/") ? path.slice(root.length) : undefined),
      mapText: (text: string) => text.replaceAll(root, ""),
    };
    const describe = (o: SpawnOutcome, r: CheckResult) =>
      (r.kind === "failure" ? `${r.failure}: ${r.detail}; ` : "") +
      (o.spawnError ?? `exit code ${o.exitCode}, signal ${o.signal}, stdout ${JSON.stringify(o.stdout.slice(0, 200))}, stderr ${JSON.stringify(o.stderr.slice(0, 400))}`);
    for (const [name, expected] of [
      ["clean.ts", []],
      ["error.ts", [probeExpected]],
    ] as const) {
      const outcome = await spawnLint(options, [join(root, name)], root, options.probeTimeoutMs ?? 60_000);
      if (outcome.stdout.includes(probeMarker)) return { ok: false, reason: "executes-operand", detail: "the command ran the operand of --lint" };
      const result = interpret(outcome, m, libraryRoot);
      const same = result.kind === "plain" && result.provisional.length === 0 && JSON.stringify(result.diagnostics) === JSON.stringify(expected);
      if (!same) {
        const wanted = expected.length === 0 ? "no diagnostic and exit code 0" : "exit code 2 and error.ts(2,7): error TS2322";
        return { ok: false, reason: name === "clean.ts" ? "clean-file" : "error-file", detail: `${name} must give ${wanted}: ${describe(outcome, result)}` };
      }
    }
    return { ok: true };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Directories above the materialised root that would change what the command resolves.
export function hazardsAbove(directory: string): string[] {
  const found: string[] = [];
  let d = directory;
  for (;;) {
    for (const name of ["node_modules", "package.json", "tsconfig.json", "jsconfig.json"]) {
      if (existsSync(join(d, name))) found.push(join(d, name));
    }
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return found;
}

export function createSpawnCheck(options: SpawnCheckOptions, supports: (input: CheckInput) => string | undefined, libraryRoot = "bundled:///libs/"): Check {
  let verdict: Promise<ProbeVerdict> | undefined;
  return {
    name: options.name ?? "cli",
    level: "first-section",
    async check(input) {
      const v = await (verdict ??= probe(options));
      if (!v.ok) return failure("probe", `${v.reason}: ${v.detail}`);
      const unsupported = supports(input);
      if (unsupported !== undefined) return failure("unsupported", unsupported);
      const m = input.materialise();
      if (m.roots.length === 0) return failure("unsupported", "no root file");
      return interpret(await spawnLint(options, m.roots, m.currentDirectory), m, libraryRoot);
    },
  };
}
