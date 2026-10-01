// Research prototype: checks that need no command. They prove the pipeline before a linter exists.
import { tsgoRules } from "../../error-baseline-format/top-down/diagnosticwriter";
import { readErrorBaseline } from "../../error-baseline-format/top-down/reader";
import { toErrorBaseline } from "../../error-baseline-format/top-down/shape";
import { type Check, type CheckInput, type CheckOutput, checkOf, toCheckDiagnostics } from "./check";
import { parsePlainDiagnostics } from "./plain";
import { type Oracle, filesOf, firstSection } from "./run";

// The diagnostics that the oracle has, read from its baseline: spans and related information are known.
export function replayCheck(oracle: (input: CheckInput) => Oracle): Check {
  return checkOf("replay", (input): CheckOutput => {
    const o = oracle(input);
    if (o.kind === "C") return { kind: "diagnostics", diagnostics: [], standIns: [], configured: true };
    const model = tsgoRules.model;
    const units = filesOf(input).map(f => ({ unitName: model.fromString(f.unitName), content: model.fromString(f.content) }));
    const parsed = readErrorBaseline(tsgoRules, model.fromBytes(o.bytes), { units });
    return { kind: "diagnostics", diagnostics: toErrorBaseline(parsed).diagnostics, standIns: [], configured: true };
  });
}

// No diagnostic at all: what a checker that checks nothing reports.
export function emptyCheck(): Check {
  return checkOf("empty", () => ({ kind: "diagnostics", diagnostics: [], standIns: [], configured: true }));
}

// The first section of the oracle as a command would print it on stderr: real names, line breaks of the platform.
export function plainReplayCheck(oracle: (input: CheckInput) => Oracle, configured: boolean): Check {
  return checkOf("plain replay", (input): CheckOutput => {
    const o = oracle(input);
    let stderr = "";
    const root = "/tmp/instance-root";
    if (o.kind === "E") {
      const text = tsgoRules.model.toString(tsgoRules.model.fromBytes(o.bytes));
      const names = new Map<string, string>();
      for (const f of filesOf(input)) names.set(f.unitName.replace(/^\/\.(?:ts|lib|src)\//, ""), f.unitName);
      const head = /^(\S.*?)\((\d+|--),(\d+|--)\): (error|warning|suggestion|message) TS(-?\d+): /s;
      for (const line of firstSection(text).split("\r\n")) {
        if (line === "") continue;
        const m = /^(error|warning|suggestion|message) TS/.test(line) ? null : head.exec(line);
        if (m === null) {
          stderr += line + "\n";
          continue;
        }
        // The harness cut the root of the name and masked the place in a library file.
        const virtual = names.get(m[1]) ?? (m[2] === "--" ? "" : m[1].startsWith("/") || /^[a-z]:\//i.test(m[1]) ? m[1] : "/.src/" + m[1]);
        const real = virtual === "" ? "/usr/lib/bun/" + m[1] : virtual.startsWith("/") ? root + virtual : root + "/" + virtual;
        const at = m[2] === "--" ? "(1,1)" : `(${m[2]},${m[3]})`;
        stderr += real + at + line.slice(m[1].length + 2 + m[2].length + 1 + m[3].length) + "\n";
      }
    }
    const parsed = parsePlainDiagnostics(stderr);
    if (!parsed.ok) return { kind: "failure", failure: "protocol", reason: `line ${parsed.at}: ${parsed.reason}` };
    const out = toCheckDiagnostics(parsed.diagnostics, root + input.currentDirectory, {
      toVirtual: p => (p === root ? "/" : p.startsWith(root + "/") ? (/^\/[a-z]:\//i.test(p.slice(root.length)) ? p.slice(root.length + 1) : p.slice(root.length)) : undefined),
      mapText: t => t,
    });
    if (out.kind === "diagnostics" && configured) out.configured = true;
    return out;
  });
}
