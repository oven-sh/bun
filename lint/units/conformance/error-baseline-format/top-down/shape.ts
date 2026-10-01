// The shape that the runner and its check function exchange, and its conversion to the input of the writer.
// Plain data: strings are JavaScript strings, nothing depends on the identity of an object.
import {
  type Diagnostic as WriterDiagnostic,
  type FileLike,
  type Rules,
  categoryFromName,
  categoryName,
  computeLineOfPosition,
} from "./diagnosticwriter";
import { type TestFile, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";
import type { ParsedErrorBaseline } from "./reader";
import { comparePaths } from "./tspath";

export type DiagnosticCategory = "warning" | "error" | "suggestion" | "message";

export interface DiagnosticMessageChain {
  messageText: string;
  next?: DiagnosticMessageChain[];
}

export interface DiagnosticLocation {
  // Name of the file as the harness has it: "/.src/a.ts", "bundled:///libs/lib.es5.d.ts".
  file: string;
  // 1-based line and 1-based column in UTF-16 code units, as tsc prints them. Absent: not known (masked).
  line?: number;
  character?: number;
  // Offset and length in the unit of the rules: UTF-8 bytes (tsgo), UTF-16 code units (tsc).
  // start is absent when the text of the file is not known; length is absent when it is not known.
  start?: number;
  length?: number;
}

export interface RelatedInformation extends DiagnosticMessageChain {
  code: number;
  location?: DiagnosticLocation;
}

export interface Diagnostic extends DiagnosticMessageChain {
  category: DiagnosticCategory;
  code: number;
  // Absent: a diagnostic without a file. Such diagnostics keep the order of the array.
  location?: DiagnosticLocation;
  // Absent: not known. The plain format of tsc does not print it.
  relatedInformation?: RelatedInformation[];
}

export interface InputFile {
  unitName: string;
  content: string;
}

export interface ErrorBaseline {
  rules: "tsgo" | "tsc";
  pretty: boolean;
  files: InputFile[];
  diagnostics: Diagnostic[];
}

function chainOut(rules: Rules, chain: WriterDiagnostic[]): DiagnosticMessageChain[] | undefined {
  if (chain.length === 0) return undefined;
  return chain.map(c => ({ messageText: rules.model.toString(c.messageText), next: chainOut(rules, c.messageChain) }));
}

function locationOut(
  rules: Rules,
  d: WriterDiagnostic,
  inputs: Set<string>,
  lengthKnown: boolean,
): DiagnosticLocation | undefined {
  const file = d.file;
  if (file === undefined) return undefined;
  const name = rules.model.toString(file.fileName);
  void inputs;
  if ("wanted" in file) {
    // No input file: the text is made up, the line and the column are what the baseline has.
    const masked = isDefaultLibraryFile(file.fileName);
    if (masked) return { file: name };
    const line = computeLineOfPosition(file.lineMap!, d.pos);
    return { file: name, line: line + 1, character: d.pos - file.lineMap![line] + 1 };
  }
  const line = computeLineOfPosition(file.lineMap!, d.pos);
  const character = rules.model.utf16Length(file.text, file.lineMap![line], d.pos);
  return {
    file: name,
    line: line + 1,
    character: character + 1,
    start: d.pos,
    length: lengthKnown ? d.end - d.pos : undefined,
  };
}

export function toErrorBaseline(parsed: ParsedErrorBaseline): ErrorBaseline {
  const rules = parsed.rules;
  const inputs = new Set(parsed.files.map(f => f.content));
  return {
    rules: rules.name,
    pretty: parsed.pretty,
    files: parsed.files.map(f => ({
      unitName: rules.model.toString(f.unitName),
      content: rules.model.toString(f.content),
    })),
    diagnostics: parsed.diagnostics.map(d => ({
      category: categoryName(d.category) as DiagnosticCategory,
      code: d.code,
      messageText: rules.model.toString(d.messageText),
      next: chainOut(rules, d.messageChain),
      location: locationOut(rules, d, inputs, true),
      relatedInformation: d.relatedInformation.map(r => ({
        code: r.code,
        messageText: rules.model.toString(r.messageText),
        next: chainOut(rules, r.messageChain),
        location: locationOut(rules, r, inputs, parsed.pretty),
      })),
    })),
  };
}

export interface WriterInput {
  files: TestFile[];
  diagnostics: WriterDiagnostic[];
}

const caseInsensitive = { useCaseSensitiveFileNames: false, currentDirectory: "" };

// Builds the files and diagnostics of the writer. One FileLike stands for one name.
export function toWriterInput(rules: Rules, files: InputFile[], diagnostics: Diagnostic[]): WriterInput {
  const model = rules.model;
  const inputs: TestFile[] = files.map(f => ({
    unitName: model.fromString(f.unitName),
    content: model.fromString(f.content),
  }));
  const known = new Map<string, FileLike>();
  const made = new Map<string, { file: FileLike; wanted: [number, number][]; masked: number }>();
  const pending: (() => void)[] = [];

  const inputOf = (name: string): TestFile | undefined => {
    let found: TestFile | undefined;
    const shown = removeTestPathPrefixes(rules, name);
    for (const f of inputs) if (f.unitName === name || removeTestPathPrefixes(rules, f.unitName) === shown) found = f;
    if (found !== undefined) return found;
    for (const f of inputs) {
      if (comparePaths(shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive) === 0) found = f;
    }
    return found;
  };
  const isConfig = (name: string): boolean => /(^|\/)[tj]sconfig\.json$/i.test(name);

  const place = (at: DiagnosticLocation | undefined, d: WriterDiagnostic): void => {
    if (at === undefined) return;
    const name = model.fromString(at.file);
    const input = inputOf(name);
    if (input !== undefined) {
      let file = known.get(name);
      if (file === undefined) {
        file = { fileName: name, text: input.content, isConfigFile: isConfig(name) };
        file.lineMap = model.lineStarts(file.text);
        known.set(name, file);
      }
      d.file = file;
      if (at.start !== undefined) {
        d.pos = at.start;
      } else if (at.line !== undefined && at.character !== undefined) {
        const starts = file.lineMap!;
        const pos =
          at.line - 1 < starts.length
            ? model.advanceUTF16(file.text, starts[at.line - 1], at.character - 1, file.text.length)
            : undefined;
        if (pos === undefined) throw new Error(`${at.file}(${at.line},${at.character}) is no position`);
        d.pos = pos;
      } else {
        throw new Error(`${at.file}: a diagnostic in an input file needs a position`);
      }
      d.end = d.pos + (at.length ?? 0);
      return;
    }
    let m = made.get(name);
    if (m === undefined) {
      m = { file: { fileName: name, text: "", isConfigFile: isConfig(name) }, wanted: [], masked: 0 };
      made.set(name, m);
    }
    d.file = m.file;
    const entry = m;
    if (at.line === undefined || at.character === undefined) {
      const rank = entry.masked++;
      pending.push(() => (d.pos = d.end = rank));
    } else {
      const { line, character } = at;
      entry.wanted.push([line, character]);
      pending.push(() => (d.pos = d.end = entry.file.lineMap![line - 1] + character - 1));
    }
  };

  const chainIn = (next: DiagnosticMessageChain[] | undefined, code: number, category: number): WriterDiagnostic[] =>
    (next ?? []).map(c => ({
      file: undefined,
      pos: -1,
      end: -1,
      code,
      category,
      messageText: model.fromString(c.messageText),
      messageChain: chainIn(c.next, code, category),
      relatedInformation: [],
    }));

  let rank = 0;
  const out: WriterDiagnostic[] = diagnostics.map(d => {
    const category = categoryFromName(d.category)!;
    const w: WriterDiagnostic = {
      file: undefined,
      pos: -1,
      end: -1,
      code: d.code,
      category,
      messageText: model.fromString(d.messageText),
      messageChain: chainIn(d.next, d.code, category),
      relatedInformation: [],
    };
    if (d.location === undefined) w.pos = w.end = rank++;
    else place(d.location, w);
    for (const r of d.relatedInformation ?? []) {
      const rw: WriterDiagnostic = {
        file: undefined,
        pos: -1,
        end: -1,
        code: r.code,
        category: 3,
        messageText: model.fromString(r.messageText),
        messageChain: chainIn(r.next, r.code, 3),
        relatedInformation: [],
      };
      place(r.location, rw);
      w.relatedInformation.push(rw);
    }
    return w;
  });
  for (const m of made.values()) {
    // Text in which every wanted line has the wanted columns; masked entries are the first columns of line 1.
    let maxLine = 1;
    const width = new Map<number, number>([[1, m.masked]]);
    for (const [line, character] of m.wanted) {
      maxLine = Math.max(maxLine, line);
      width.set(line, Math.max(width.get(line) ?? 0, character - 1));
    }
    const lines: string[] = [];
    for (let l = 1; l <= maxLine; l++) lines.push(" ".repeat(width.get(l) ?? 0));
    m.file.text = lines.join("\n");
    m.file.lineMap = model.lineStarts(m.file.text);
  }
  for (const p of pending) p();
  return { files: inputs, diagnostics: out };
}
