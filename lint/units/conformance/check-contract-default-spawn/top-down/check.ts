// Research prototype: the contract between the runner and a check function, and the check that spawns a command.
// It imports nothing of the test harness: the command and the environment are given by the caller.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { Diagnostic, DiagnosticCategory, DiagnosticLocation, DiagnosticMessageChain } from "../../error-baseline-format/top-down/shape";
import { type PlainChain, type PlainDiagnostic, parsePlainDiagnostics } from "./plain";

export interface CheckFile {
  // Name as the harness has it: absolute and normalised, "/.src/a.ts".
  name: string;
  content: string;
}

export type CompilerOptionValue = boolean | number | string | string[];

export interface Materialised {
  // The directory that stands for the root of the file system of the instance.
  root: string;
  // Real path of the current directory of the instance; it exists.
  currentDirectory: string;
  // Real paths of rootNames, in order.
  rootNames: string[];
  toReal(virtualName: string): string;
  toVirtual(realPath: string): string | undefined;
  // Every occurrence of the root in a text becomes the virtual name.
  mapText(text: string): string;
}

export type MaterialiseResult = { ok: true; value: Materialised } | { ok: false; status: string; reason: string };

export interface CheckInput {
  // The configured name: the stem of every baseline of the instance.
  name: string;
  suite: "compiler" | "conformance";
  casePath: string;
  // Names in lower case and one value each, as the directives and the variation give them.
  configuration: Readonly<Record<string, string>>;
  // What the directives set, in the form of "compilerOptions" of a tsconfig.json, and noErrorTruncation of the harness.
  compilerOptions: Readonly<Record<string, CompilerOptionValue>>;
  // What the harness sets where neither the configuration file nor compilerOptions has a value.
  defaultOptions: Readonly<Record<string, CompilerOptionValue>>;
  captureSuggestions: boolean;
  useCaseSensitiveFileNames: boolean;
  currentDirectory: string;
  // The files, which are the sections of the baseline in this order: configuration file, roots, other files.
  configFile: CheckFile | undefined;
  roots: CheckFile[];
  otherFiles: CheckFile[];
  // File names of the program in order: roots that are no .json and no .tsbuildinfo, then the files of @libFiles.
  rootNames: string[];
  links: { path: string; target: string }[];
  includeLibDirectory: boolean;
  // Writes the file system below a new directory. The runner removes the directory after the check.
  materialise(): MaterialiseResult;
}

// A diagnostic that no oracle has: a rule of the linter.
export interface RuleDiagnostic {
  rule: string;
  category: DiagnosticCategory;
  messageText: string;
  location?: DiagnosticLocation;
}

export interface CheckDiagnostics {
  kind: "diagnostics";
  // File names are virtual. A start is in UTF-8 bytes; line and character are 1-based, the character in UTF-16 units.
  diagnostics: Diagnostic[];
  rules?: RuleDiagnostic[];
  // Names of the stand-ins that the run reached.
  standIns: string[];
  // True: the run had the options of the instance. Absent or false: it had the options of the command.
  configured?: boolean;
  // Diagnostics of rules that the caller named and the check left out.
  ignoredRuleDiagnostics?: number;
}

export type FailureKind = "crash" | "timeout" | "refusal" | "protocol" | "unsupported" | "internal";

export interface CheckFailure {
  kind: "failure";
  failure: FailureKind;
  reason: string;
  exitCode?: number | null;
  signal?: string | number | null;
  stdout?: string;
  stderr?: string;
}

export type CheckOutput = CheckDiagnostics | CheckFailure;

export interface CheckContext {
  // Time for one instance.
  timeoutMs: number;
}

export interface Check {
  readonly name: string;
  // Most instances in one call. Absent: one.
  readonly batchSize?: number;
  // One output for each input, in order.
  run(inputs: readonly CheckInput[], context: CheckContext): Promise<CheckOutput[]>;
}

export function checkOf(
  name: string,
  one: (input: CheckInput, context: CheckContext) => CheckOutput | Promise<CheckOutput>,
): Check {
  return { name, run: async (inputs, context) => Promise.all(inputs.map(input => one(input, context))) };
}

export function failure(kind: FailureKind, reason: string, more: Partial<CheckFailure> = {}): CheckFailure {
  return { kind: "failure", failure: kind, reason, ...more };
}

export interface SpawnCheckOptions {
  // The command without the flag and the operands: [bunExe()].
  command: string[];
  // The environment of the caller: bunEnv.
  env: Record<string, string | undefined>;
  // Time for each run of the probe.
  probeTimeoutMs?: number;
  // Directory for the probe. Absent: a new directory below the directory of temporary files.
  probeDirectory?: string;
  // Names of rules whose diagnostics are counted and left out. Absent: a diagnostic of any rule fails the instance.
  ignoreRules?: readonly string[];
}

interface Spawned {
  exitCode: number | null;
  signal: string | number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export function spawnEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  out.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
  out.BUN_DEBUG_QUIET_LOGS = "1";
  out.NO_COLOR = "1";
  delete out.FORCE_COLOR;
  delete out.BUN_OPTIONS;
  return out;
}

async function spawn(cmd: string[], cwd: string, env: Record<string, string>, timeoutMs: number): Promise<Spawned> {
  const deadline = AbortSignal.timeout(timeoutMs);
  let proc;
  try {
    proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: deadline, killSignal: "SIGKILL" });
  } catch (e) {
    if (deadline.aborted) return { exitCode: null, signal: null, timedOut: true, stdout: "", stderr: "" };
    return { exitCode: null, signal: null, timedOut: false, stdout: "", stderr: "", spawnError: String(e) };
  }
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const signal = proc.signalCode;
  return { exitCode: proc.exitCode, signal, timedOut: deadline.aborted && signal !== null, stdout, stderr };
}

function head(text: string): string {
  const line = text.split("\n").find(l => l.trim() !== "") ?? "";
  return line.length > 200 ? line.slice(0, 200) + "..." : line;
}

// What a run of the command says, before any name is mapped.
export type Reading = { ok: true; diagnostics: PlainDiagnostic[] } | { ok: false; failure: CheckFailure };

export function readRun(run: Spawned): Reading {
  const more = { exitCode: run.exitCode, signal: run.signal, stdout: run.stdout, stderr: run.stderr };
  const fail = (kind: FailureKind, reason: string): Reading => ({ ok: false, failure: failure(kind, reason, more) });
  if (run.spawnError !== undefined) return fail("crash", `the command did not start: ${run.spawnError}`);
  if (run.timedOut) return fail("timeout", "the command did not end in time");
  if (run.signal !== null) return fail("crash", `the command ended by the signal ${run.signal}`);
  if (run.exitCode === 1) return fail("refusal", `the command refused: ${head(run.stderr)}`);
  if (run.exitCode !== 0 && run.exitCode !== 2) return fail("crash", `the command ended with the exit code ${run.exitCode}`);
  if (run.stdout !== "") return fail("protocol", `the command wrote to stdout: ${head(run.stdout)}`);
  const parsed = parsePlainDiagnostics(run.stderr);
  if (!parsed.ok) return fail("protocol", `stderr line ${parsed.at} is ${parsed.reason}: ${head(parsed.text)}`);
  const errors = parsed.diagnostics.filter(d => d.category === "error").length;
  if (run.exitCode === 0 && errors > 0) return fail("protocol", `the exit code is 0 and stderr has ${errors} errors`);
  if (run.exitCode === 2 && errors === 0) return fail("protocol", "the exit code is 2 and stderr has no error");
  return { ok: true, diagnostics: parsed.diagnostics };
}

// Codes of the command that are no codes of TypeScript and no rules.
export const standInCode = "internal-stand-in";
export const internalErrorCode = "internal-error";

function chainOf(c: PlainChain, map: (text: string) => string): DiagnosticMessageChain {
  const out: DiagnosticMessageChain = { messageText: map(c.messageText) };
  if (c.next !== undefined) out.next = c.next.map(n => chainOf(n, map));
  return out;
}

function isDefaultLibraryName(path: string): boolean {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return base.startsWith("lib.") && base.endsWith(".d.ts");
}

// The names of a run, which are real, become the names of the instance.
export function toCheckDiagnostics(
  plain: PlainDiagnostic[],
  cwd: string,
  m: Pick<Materialised, "toVirtual" | "mapText">,
  ignoreRules: readonly string[] = [],
): CheckOutput {
  const diagnostics: Diagnostic[] = [];
  const rules: RuleDiagnostic[] = [];
  const standIns: string[] = [];
  let ignored = 0;
  for (const p of plain) {
    if (p.rule === standInCode) {
      standIns.push(p.messageText);
      continue;
    }
    if (p.rule === internalErrorCode) return failure("internal", `the command reports an error of its own: ${p.messageText}`);
    if (p.rule !== undefined && ignoreRules.includes(p.rule)) {
      ignored++;
      continue;
    }
    let location: DiagnosticLocation | undefined;
    if (p.path !== undefined) {
      const real = isAbsolute(p.path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(p.path) ? p.path : resolve(cwd, p.path);
      let file = m.toVirtual(real);
      if (file === undefined) {
        if (!isDefaultLibraryName(p.path)) {
          return failure("protocol", `stderr line ${p.at} names a file that is not of the instance: ${p.path}`);
        }
        file = "bundled:///libs/" + p.path.slice(Math.max(p.path.lastIndexOf("/"), p.path.lastIndexOf("\\")) + 1);
      }
      location = { file, line: p.line, character: p.character };
    }
    const chain = chainOf(p, m.mapText);
    if (p.rule !== undefined) {
      rules.push({ rule: p.rule, category: p.category, messageText: chain.messageText, location });
      continue;
    }
    const d: Diagnostic = { category: p.category, code: p.code!, messageText: chain.messageText };
    if (chain.next !== undefined) d.next = chain.next;
    if (location !== undefined) d.location = location;
    diagnostics.push(d);
  }
  const out: CheckDiagnostics = { kind: "diagnostics", diagnostics, standIns };
  if (rules.length > 0) out.rules = rules;
  if (ignored > 0) out.ignoredRuleDiagnostics = ignored;
  return out;
}

export const probeSays = "bun-lint-probe: the file ran";

export interface ProbeResult {
  ok: boolean;
  reason: string;
}

// One harmless file that leaves a mark when a command runs it, and one file that no parser accepts.
export async function probe(options: SpawnCheckOptions): Promise<ProbeResult> {
  const made = options.probeDirectory === undefined;
  const dir = options.probeDirectory ?? mkdtempSync(resolve(realpathSync(tmpdir()), "bun-lint-probe-"));
  mkdirSync(dir, { recursive: true });
  const mark = resolve(dir, "ran.txt");
  const ok = resolve(dir, "ok.ts");
  const bad = resolve(dir, "bad.ts");
  // No import and no name that a checker without type packages does not know: TypeScript 6.0.2 reports nothing.
  writeFileSync(
    ok,
    `const probe = globalThis as any;\nprobe.process.stdout.write(${JSON.stringify(probeSays + "\n")});\n` +
      `void probe.Bun.write(${JSON.stringify(mark)}, "ran");\nexport {};\n`,
  );
  writeFileSync(bad, "const = ;\n");
  const env = spawnEnvironment(options.env);
  const timeout = options.probeTimeoutMs ?? 60_000;
  try {
    const first = await spawn([...options.command, "--lint", ok], dir, env, timeout);
    if (existsSync(mark) || first.stdout.includes(probeSays)) {
      return { ok: false, reason: "the command ran the file that it was to check" };
    }
    const a = readRun(first);
    if (!a.ok) return { ok: false, reason: `a file without an error: ${a.failure.reason}` };
    if (first.exitCode !== 0 || a.diagnostics.length > 0) {
      return { ok: false, reason: `a file without an error gave ${a.diagnostics.length} diagnostics and the exit code ${first.exitCode}` };
    }
    const second = await spawn([...options.command, "--lint", bad], dir, env, timeout);
    if (existsSync(mark)) return { ok: false, reason: "the command ran the file that it was to check" };
    const b = readRun(second);
    if (!b.ok) return { ok: false, reason: `a file with a syntax error: ${b.failure.reason}` };
    const real = realpathSync(bad);
    const hit = b.diagnostics.some(
      d => d.category === "error" && d.path !== undefined && [bad, real].includes(resolve(dir, d.path)),
    );
    if (second.exitCode !== 2 || !hit) {
      return { ok: false, reason: `a file with a syntax error gave no error in it (exit code ${second.exitCode})` };
    }
    return { ok: true, reason: "" };
  } finally {
    if (made) rmSync(dir, { recursive: true, force: true });
  }
}

// The check of the specification: the roots are the operands, stderr has the plain format.
export function createSpawnCheck(options: SpawnCheckOptions): Check {
  let probed: Promise<ProbeResult> | undefined;
  const env = spawnEnvironment(options.env);
  return {
    name: "spawn",
    async run(inputs, context) {
      probed ??= probe(options);
      const p = await probed;
      if (!p.ok) return inputs.map(() => failure("refusal", `the command is no linter: ${p.reason}`));
      return Promise.all(
        inputs.map(async (input): Promise<CheckOutput> => {
          const m = input.materialise();
          if (!m.ok) return failure("unsupported", `${m.status}: ${m.reason}`);
          const run = await spawn([...options.command, "--lint", ...m.value.rootNames], m.value.currentDirectory, env, context.timeoutMs);
          const read = readRun(run);
          if (!read.ok) return read.failure;
          return toCheckDiagnostics(read.diagnostics, m.value.currentDirectory, m.value, options.ignoreRules);
        }),
      );
    },
  };
}
