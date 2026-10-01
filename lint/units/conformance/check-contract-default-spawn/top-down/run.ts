// Research prototype: one instance through a check, the writer and the comparison with the oracle.
import {
  type Diagnostic as WriterDiagnostic,
  type Rules,
  WriterPanic,
  compareDiagnostics,
  formatDiagnosticsWithColorAndContext,
  tsgoRules,
  writeFormatDiagnostics,
} from "../../error-baseline-format/top-down/diagnosticwriter";
import { formatOpts, getErrorBaseline, removeTestPathPrefixes } from "../../error-baseline-format/top-down/error_baseline";
import { type Diagnostic, type InputFile, toWriterInput } from "../../error-baseline-format/top-down/shape";
import type { Check, CheckContext, CheckDiagnostics, CheckFailure, CheckInput, CheckOutput } from "./check";
import { failure } from "./check";

// Strongest first. "baseline": every byte of the baseline. "first-section": the baseline starts with the first
// section of the run. The level of a result follows from what the result holds, before anything is compared.
export type Level = "baseline" | "first-section";
export const levels: readonly Level[] = ["baseline", "first-section"];

export function atLeast(level: Level, wanted: Level): boolean {
  return levels.indexOf(level) <= levels.indexOf(wanted);
}

export type Kind = "E" | "C";
// "unsupported": the check could not run the instance as it is, for one: it could not hand its options over.
export type Status = "pass" | "fail" | "provisional" | "error" | "unsupported";

// The first section of a run that did not have the options of the instance. It is a report and never a pass.
export interface Loose {
  equal: boolean;
  reason: string;
  diff?: string;
}

export type Oracle = { kind: "E"; bytes: Uint8Array; path: string } | { kind: "C" };

export interface RunResult {
  name: string;
  suite: string;
  kind: Kind;
  status: Status;
  // The level of the comparison. Absent when nothing was compared.
  level?: Level;
  reason: string;
  diff?: string;
  failure?: CheckFailure;
  standIns?: string[];
  loose?: Loose;
  // True: the diagnostics of the checker are equal and diagnostics of rules are the only difference.
  onlyRules?: boolean;
  ignoredRuleDiagnostics?: number;
}

const rules: Rules = tsgoRules;
const esc = "\x1b";
// error_baseline.go:31, as the writer has it.
const diagnosticsLocationPrefixGo = /(?<![^\n])([lL][iI][bB][^\n]*\.[dD]\.[tT](?:[sS]|\xc5\xbf))\(\d+,\d+\)/g;

export function isPretty(input: Pick<CheckInput, "configuration">): boolean {
  return (input.configuration["pretty"] ?? "").toLowerCase() === "true";
}

export function filesOf(input: CheckInput): InputFile[] {
  const files = [...(input.configFile !== undefined ? [input.configFile] : []), ...input.roots, ...input.otherFiles];
  return files.map(f => ({ unitName: f.name, content: f.content }));
}

// A baseline shows the span of a diagnostic in a file of the instance only; of a related place the pretty form does.
function spansKnown(d: Diagnostic, pretty: boolean, units: ReadonlySet<string>): boolean {
  if (d.location !== undefined && d.location.length === undefined && units.has(d.location.file)) return false;
  if (d.relatedInformation === undefined) return false;
  return d.relatedInformation.every(
    r => r.location === undefined || !pretty || r.location.length !== undefined || !units.has(r.location.file),
  );
}

function unitNames(input: CheckInput): Set<string> {
  return new Set(filesOf(input).map(f => f.unitName));
}

export function levelOf(out: CheckDiagnostics, pretty: boolean, units: ReadonlySet<string>): Level {
  return out.diagnostics.every(d => spansKnown(d, pretty, units)) ? "baseline" : "first-section";
}

// Path and start, and nothing that a run without spans does not know: the order of the input decides a tie.
function compareByStart(a: WriterDiagnostic, b: WriterDiagnostic): number {
  const pa = a.file?.fileName ?? "";
  const pb = b.file?.fileName ?? "";
  const c = rules.model.compare(pa, pb);
  if (c !== 0) return c;
  return a.pos - b.pos;
}

// error_baseline.go:143-147, the first section with the two line breaks that end it.
function topOf(sorted: WriterDiagnostic[], pretty: boolean): string {
  let top = pretty
    ? formatDiagnosticsWithColorAndContext(rules, sorted, formatOpts)
    : writeFormatDiagnostics(rules, sorted, formatOpts);
  top = removeTestPathPrefixes(rules, top);
  top = top.replace(diagnosticsLocationPrefixGo, "$1(--,--)");
  return top + "\r\n\r\n";
}

const sectionHead = /^==== (.*) \((\d+) errors\) ====$/s;

// For a diff only: the comparison itself asks whether the oracle starts with the first section of the run.
export function firstSection(text: string): string {
  const lines = text.split("\r\n");
  let end = lines.findIndex(l => l.startsWith("!!! ") || sectionHead.test(l) || /^Found (?:1 error|\d+ errors)(?:\.| in )/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(0, end).join("\r\n");
}

function show(text: string): string[] {
  return rules.model
    .toString(text)
    .replaceAll(esc, "\\x1b")
    .split("\r\n");
}

// Lines that differ, between what is equal at the start and at the end.
export function diffLines(expected: string, actual: string, context = 3, most = 40): string {
  const a = show(expected);
  const b = show(actual);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let enda = a.length;
  let endb = b.length;
  while (enda > start && endb > start && a[enda - 1] === b[endb - 1]) {
    enda--;
    endb--;
  }
  const out: string[] = [`@@ line ${start + 1} @@`];
  for (const l of a.slice(Math.max(0, start - context), start)) out.push("  " + l);
  const cut = (lines: string[], mark: string) => {
    for (const l of lines.slice(0, most)) out.push(mark + l);
    if (lines.length > most) out.push(`${mark}... ${lines.length - most} more lines`);
  };
  cut(a.slice(start, enda), "- ");
  cut(b.slice(start, endb), "+ ");
  for (const l of a.slice(enda, enda + context)) out.push("  " + l);
  return out.join("\n");
}

export function compare(input: CheckInput, oracle: Oracle, out: CheckOutput, loose = false): RunResult {
  const base = { name: input.name, suite: input.suite, kind: oracle.kind };
  if (out.kind === "failure") {
    const status: Status = out.failure === "unsupported" ? "unsupported" : "error";
    return { ...base, status, reason: `${out.failure}: ${out.reason}`, failure: out };
  }
  if (out.configured !== true) {
    const r: RunResult = { ...base, status: "unsupported", reason: "the run did not have the options of the instance" };
    if (loose) {
      const c = compareConfigured(input, oracle, out, "first-section");
      r.loose = { equal: c.status === "pass", reason: c.status === "pass" ? "" : `${c.status}: ${c.reason}` };
      if (c.diff !== undefined) r.loose.diff = c.diff;
    }
    return r;
  }
  return compareConfigured(input, oracle, out, undefined);
}

function compareConfigured(input: CheckInput, oracle: Oracle, out: CheckDiagnostics, most: Level | undefined): RunResult {
  const base = { name: input.name, suite: input.suite, kind: oracle.kind };
  const pretty = isPretty(input);
  const units = unitNames(input);
  const own = levelOf(out, pretty, units);
  const level = most !== undefined && atLeast(own, most) ? most : own;
  if (out.standIns.length > 0) {
    return { ...base, status: "provisional", level, reason: `reached ${out.standIns.length} stand-ins`, standIns: out.standIns };
  }
  // error_baseline.go:44-48
  if (out.diagnostics.some(d => d.code === -1)) {
    return { ...base, status: "fail", level, reason: "a diagnostic has the code -1" };
  }
  const ruleNames = [...new Set((out.rules ?? []).map(r => r.rule))].sort();
  const pass = (): RunResult => {
    if (ruleNames.length === 0) {
      const r: RunResult = { ...base, status: "pass", level, reason: "" };
      if (out.ignoredRuleDiagnostics !== undefined) r.ignoredRuleDiagnostics = out.ignoredRuleDiagnostics;
      return r;
    }
    return { ...base, status: "fail", level, reason: `equal but for diagnostics of rules: ${ruleNames.join(", ")}`, onlyRules: true };
  };
  if (oracle.kind === "C") {
    if (out.diagnostics.length === 0) return pass();
    const first = out.diagnostics[0];
    return { ...base, status: "fail", level, reason: `${out.diagnostics.length} diagnostics where the oracle has none, the first is TS${first.code}: ${first.messageText}` };
  }
  const expected = rules.model.fromBytes(oracle.bytes);
  if (out.diagnostics.length === 0) {
    return { ...base, status: "fail", level, reason: "no diagnostic where the oracle has a baseline", diff: diffLines(firstSection(expected), "") };
  }
  let written: { files: ReturnType<typeof toWriterInput>["files"]; diagnostics: WriterDiagnostic[] };
  try {
    written = toWriterInput(rules, filesOf(input), out.diagnostics);
  } catch (e) {
    return { ...base, status: "fail", level, reason: `a diagnostic has no place: ${(e as Error).message}` };
  }
  try {
    if (level === "baseline") {
      const actual = getErrorBaseline(rules, written.files, written.diagnostics, pretty);
      if (actual.failedChecks.length > 0) {
        return { ...base, status: "fail", level, reason: `the writer: ${actual.failedChecks.join("; ")}`, diff: diffLines(expected, actual.text) };
      }
      if (actual.text === expected) return pass();
      return { ...base, status: "fail", level, reason: "the baseline differs", diff: diffLines(expected, actual.text) };
    }
    const known = own === "baseline";
    if (pretty && !known) {
      return { ...base, status: "fail", level, reason: "the first section of a baseline in the pretty form needs spans" };
    }
    const sorted = written.diagnostics.slice();
    if (known) sorted.sort((a, b) => compareWhole(a, b));
    else sorted.sort(compareByStart);
    const top = topOf(sorted, pretty);
    if (expected.startsWith(top)) return pass();
    return { ...base, status: "fail", level, reason: "the first section differs", diff: diffLines(firstSection(expected), firstSection(top)) };
  } catch (e) {
    if (e instanceof WriterPanic) return { ...base, status: "fail", level, reason: `the writer: ${e.message}` };
    throw e;
  }
}

function compareWhole(a: WriterDiagnostic, b: WriterDiagnostic): number {
  return compareDiagnostics(rules, a, b);
}

export interface RunOptions {
  // True: a run without the options of the instance is compared for the report. It stays "unsupported".
  loose?: boolean;
  timeoutMs?: number;
  // Calls of the check at the same time.
  concurrency?: number;
  oracle(input: CheckInput): Oracle;
  onResult?(result: RunResult): void;
}

// Every input through the check, in batches of the size that the check names.
export async function runInstances(inputs: readonly CheckInput[], check: Check, options: RunOptions): Promise<RunResult[]> {
  const context: CheckContext = { timeoutMs: options.timeoutMs ?? 30_000 };
  const size = Math.max(1, check.batchSize ?? 1);
  const batches: CheckInput[][] = [];
  for (let i = 0; i < inputs.length; i += size) batches.push(inputs.slice(i, i + size));
  const results = new Map<CheckInput, RunResult>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const batch = batches[next++];
      if (batch === undefined) return;
      let outs: CheckOutput[];
      try {
        outs = await check.run(batch, context);
        if (outs.length !== batch.length) {
          outs = batch.map(() => failure("protocol", `the check gave ${outs.length} outputs for ${batch.length} inputs`));
        }
      } catch (e) {
        outs = batch.map(() => failure("crash", `the check threw: ${String(e)}`));
      }
      batch.forEach((input, i) => {
        let r: RunResult;
        try {
          r = compare(input, options.oracle(input), outs[i], options.loose === true);
        } catch (e) {
          r = { name: input.name, suite: input.suite, kind: "E", status: "error", reason: `the runner threw: ${String(e)}` };
        }
        results.set(input, r);
        options.onResult?.(r);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 1, batches.length)) }, worker));
  return inputs.map(i => results.get(i)!);
}
