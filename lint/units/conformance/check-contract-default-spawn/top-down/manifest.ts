// Research prototype: the batch form. One process takes a manifest of instances and writes one line of JSON for each.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Diagnostic, DiagnosticLocation, DiagnosticMessageChain, RelatedInformation } from "../../error-baseline-format/top-down/shape";
import {
  type Check,
  type CheckDiagnostics,
  type CheckInput,
  type CheckOutput,
  type CompilerOptionValue,
  type Materialised,
  type SpawnCheckOptions,
  failure,
  probe,
  spawnEnvironment,
} from "./check";

export const manifestVersion = 1;
export const conformanceVariable = "BUN_INTERNAL_LINT_CONFORMANCE";

export interface ManifestInstance {
  id: string;
  // Real and absolute, as every name of the manifest.
  currentDirectory: string;
  rootNames: string[];
  configFile?: string;
  compilerOptions: Record<string, CompilerOptionValue>;
  defaultOptions: Record<string, CompilerOptionValue>;
  captureSuggestions: boolean;
}

export interface Manifest {
  version: number;
  instances: ManifestInstance[];
}

export type ReportLine =
  | { id: string; diagnostics: Diagnostic[]; standIns: string[] }
  | { id: string; refused: string };

const categories = new Set(["warning", "error", "suggestion", "message"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function only(v: Record<string, unknown>, keys: string[]): string | undefined {
  return Object.keys(v).find(k => !keys.includes(k));
}

// The shape is checked to the last field: what the runner does not know, it does not let pass.
function readChain(v: unknown, where: string): DiagnosticMessageChain[] | string {
  if (!Array.isArray(v)) return `${where} is no list`;
  const out: DiagnosticMessageChain[] = [];
  for (const [i, c] of v.entries()) {
    if (!isRecord(c) || typeof c.messageText !== "string") return `${where}[${i}] has no messageText`;
    const extra = only(c, ["messageText", "next"]);
    if (extra !== undefined) return `${where}[${i}] has the unknown field ${extra}`;
    const node: DiagnosticMessageChain = { messageText: c.messageText };
    if (c.next !== undefined) {
      const next = readChain(c.next, `${where}[${i}].next`);
      if (typeof next === "string") return next;
      if (next.length > 0) node.next = next;
    }
    out.push(node);
  }
  return out;
}

function readLocation(v: unknown, where: string, m: Materialised): DiagnosticLocation | string {
  if (!isRecord(v) || typeof v.file !== "string") return `${where} has no file`;
  const extra = only(v, ["file", "start", "length", "line", "character"]);
  if (extra !== undefined) return `${where} has the unknown field ${extra}`;
  for (const k of ["start", "length", "line", "character"] as const) {
    if (!Number.isInteger(v[k]) || (v[k] as number) < (k === "line" || k === "character" ? 1 : 0)) return `${where}.${k} is no position`;
  }
  let file = m.toVirtual(v.file);
  if (file === undefined) {
    const base = v.file.slice(Math.max(v.file.lastIndexOf("/"), v.file.lastIndexOf("\\")) + 1);
    if (!base.startsWith("lib.") || !base.endsWith(".d.ts")) return `${where}.file is not of the instance: ${v.file}`;
    file = "bundled:///libs/" + base;
  }
  return { file, start: v.start as number, length: v.length as number, line: v.line as number, character: v.character as number };
}

export function readReportLine(text: string, m: Materialised): ReportLine | string {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return "no JSON";
  }
  if (!isRecord(v) || typeof v.id !== "string") return "no id";
  if (typeof v.refused === "string") {
    const extra = only(v, ["id", "refused"]);
    return extra === undefined ? { id: v.id, refused: v.refused } : `the unknown field ${extra}`;
  }
  const extra = only(v, ["id", "diagnostics", "standIns"]);
  if (extra !== undefined) return `the unknown field ${extra}`;
  if (!Array.isArray(v.standIns) || !v.standIns.every(s => typeof s === "string")) return "standIns is no list of names";
  if (!Array.isArray(v.diagnostics)) return "diagnostics is no list";
  const diagnostics: Diagnostic[] = [];
  for (const [i, d] of v.diagnostics.entries()) {
    const where = `diagnostics[${i}]`;
    if (!isRecord(d)) return `${where} is no object`;
    const unknown = only(d, ["category", "code", "messageText", "next", "location", "relatedInformation"]);
    if (unknown !== undefined) return `${where} has the unknown field ${unknown}`;
    if (typeof d.category !== "string" || !categories.has(d.category)) return `${where}.category is unknown`;
    if (!Number.isInteger(d.code)) return `${where}.code is no number`;
    if (typeof d.messageText !== "string") return `${where} has no messageText`;
    const next = readChain(d.next ?? [], `${where}.next`);
    if (typeof next === "string") return next;
    const out: Diagnostic = { category: d.category as Diagnostic["category"], code: d.code as number, messageText: m.mapText(d.messageText) };
    if (next.length > 0) out.next = mapChain(next, m);
    if (d.location !== undefined) {
      const at = readLocation(d.location, `${where}.location`, m);
      if (typeof at === "string") return at;
      out.location = at;
    }
    if (!Array.isArray(d.relatedInformation)) return `${where}.relatedInformation is no list`;
    const related: RelatedInformation[] = [];
    for (const [k, r] of d.relatedInformation.entries()) {
      const rw = `${where}.relatedInformation[${k}]`;
      if (!isRecord(r) || !Number.isInteger(r.code) || typeof r.messageText !== "string") return `${rw} has no code or no messageText`;
      const ru = only(r, ["code", "messageText", "next", "location"]);
      if (ru !== undefined) return `${rw} has the unknown field ${ru}`;
      const rn = readChain(r.next ?? [], `${rw}.next`);
      if (typeof rn === "string") return rn;
      const ro: RelatedInformation = { code: r.code as number, messageText: m.mapText(r.messageText) };
      if (rn.length > 0) ro.next = mapChain(rn, m);
      if (r.location !== undefined) {
        const at = readLocation(r.location, `${rw}.location`, m);
        if (typeof at === "string") return at;
        ro.location = at;
      }
      related.push(ro);
    }
    out.relatedInformation = related;
    diagnostics.push(out);
  }
  return { id: v.id, diagnostics, standIns: v.standIns as string[] };
}

function mapChain(chain: DiagnosticMessageChain[], m: Materialised): DiagnosticMessageChain[] {
  return chain.map(c => (c.next === undefined ? { messageText: m.mapText(c.messageText) } : { messageText: m.mapText(c.messageText), next: mapChain(c.next, m) }));
}

interface Pending {
  index: number;
  input: CheckInput;
  m: Materialised;
}

export interface ManifestCheckOptions extends SpawnCheckOptions {
  batchSize?: number;
  // Directory for the manifests. Absent: a new directory below the directory of temporary files.
  directory?: string;
}

export function createManifestCheck(options: ManifestCheckOptions): Check {
  let probed: ReturnType<typeof probe> | undefined;
  const env = { ...spawnEnvironment(options.env), [conformanceVariable]: "1" };
  let dir: string | undefined;
  let manifests = 0;

  // One process for what is left of a batch. It says how far it came.
  async function submit(pending: Pending[], outs: CheckOutput[], timeoutMs: number): Promise<number> {
    dir ??= options.directory ?? mkdtempSync(resolve(realpathSync(tmpdir()), "bun-lint-manifest-"));
    mkdirSync(dir, { recursive: true });
    const manifest: Manifest = {
      version: manifestVersion,
      instances: pending.map(p => ({
        id: String(p.index),
        currentDirectory: p.m.currentDirectory,
        rootNames: p.m.rootNames,
        ...(p.input.configFile !== undefined ? { configFile: p.m.toReal(p.input.configFile.name) } : {}),
        compilerOptions: { ...p.input.compilerOptions },
        defaultOptions: { ...p.input.defaultOptions },
        captureSuggestions: p.input.captureSuggestions,
      })),
    };
    const path = resolve(dir, `manifest-${manifests++}.json`);
    writeFileSync(path, JSON.stringify(manifest));
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    controller.signal.addEventListener("abort", () => (timedOut = true));
    let proc;
    try {
      proc = Bun.spawn({ cmd: [...options.command, "--lint", path], cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: controller.signal, killSignal: "SIGKILL" });
    } catch (e) {
      clearTimeout(timer);
      outs[pending[0].index] = failure("crash", `the command did not start: ${String(e)}`);
      return 1;
    }
    const stderr = proc.stderr.text();
    let done = 0;
    let rest = "";
    let broken: string | undefined;
    const decoder = new TextDecoder();
    const take = (line: string) => {
      if (broken !== undefined) return;
      const p = pending[done];
      if (p === undefined) {
        broken = "more lines than instances";
        return;
      }
      const r = readReportLine(line, p.m);
      if (typeof r === "string") outs[p.index] = failure("protocol", `the line of the report: ${r}`);
      else if (r.id !== String(p.index)) outs[p.index] = failure("protocol", `the line of the report has the id ${r.id}`);
      else if ("refused" in r) outs[p.index] = failure("refusal", `the command refused: ${r.refused}`);
      else outs[p.index] = { kind: "diagnostics", diagnostics: r.diagnostics, standIns: r.standIns, configured: true } satisfies CheckDiagnostics;
      done++;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), timeoutMs);
    };
    for await (const chunk of proc.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      let at: number;
      while ((at = rest.indexOf("\n")) >= 0) {
        take(rest.slice(0, at));
        rest = rest.slice(at + 1);
      }
    }
    await proc.exited;
    clearTimeout(timer);
    const err = await stderr;
    const more = { exitCode: proc.exitCode, signal: proc.signalCode, stderr: err };
    if (done < pending.length) {
      const p = pending[done];
      if (timedOut && proc.signalCode !== null) outs[p.index] = failure("timeout", "the command did not end in time", more);
      else if (proc.signalCode !== null) outs[p.index] = failure("crash", `the command ended by the signal ${proc.signalCode}`, more);
      else if (proc.exitCode === 1) outs[p.index] = failure("refusal", `the command refused: ${err.split("\n")[0]}`, more);
      else if (proc.exitCode !== 0) outs[p.index] = failure("crash", `the command ended with the exit code ${proc.exitCode}`, more);
      else outs[p.index] = failure("protocol", `the command ended after ${done} of ${pending.length} lines${rest !== "" ? " and a part of a line" : ""}`, more);
      return done + 1;
    }
    if (proc.signalCode !== null || proc.exitCode !== 0 || rest !== "" || broken !== undefined) {
      // Every line is there and the end is not clean: no line is to be trusted.
      for (const p of pending) outs[p.index] = failure("protocol", `the command ended with ${proc.signalCode ?? proc.exitCode} after the last line`, more);
    }
    return pending.length;
  }

  return {
    name: "manifest",
    batchSize: options.batchSize ?? 256,
    async run(inputs, context) {
      probed ??= probe(options);
      const p = await probed;
      if (!p.ok) return inputs.map(() => failure("refusal", `the command is no linter: ${p.reason}`));
      const outs: CheckOutput[] = new Array(inputs.length);
      let pending: Pending[] = [];
      inputs.forEach((input, index) => {
        const m = input.materialise();
        if (!m.ok) outs[index] = failure("unsupported", `${m.status}: ${m.reason}`);
        else pending.push({ index, input, m: m.value });
      });
      // After a failure the process is gone: what it did not reach goes to a new one.
      while (pending.length > 0) {
        const reached = await submit(pending, outs, context.timeoutMs);
        const blamed = pending[reached - 1];
        const out = outs[blamed.index];
        // A command that keeps its lines back lets the blame fall on an instance before the one that failed.
        if (pending.length > 1 && out.kind === "failure" && out.failure !== "refusal" && reached <= pending.length) {
          await submit([blamed], outs, context.timeoutMs);
        }
        pending = pending.slice(reached);
      }
      return outs;
    },
  };
}

export function removeManifestDirectory(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
