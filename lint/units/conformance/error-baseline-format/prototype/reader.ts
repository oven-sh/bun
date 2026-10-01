// The reader of .errors.txt baselines: bytes to diagnostics and files, the inverse of getErrorBaseline.
import { Category, type Diagnostic, type FileLike, categoryName, computeECMALineStarts, flattenDiagnosticMessage } from "./diagnosticwriter";
import { type Rules, type TestFile, getErrorBaseline, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";
import { type ByteString, decodeRune, replaceNonWhitespace, utf16Len } from "./go_compat";
import * as tsc from "./tsc_rules";
import { comparePaths, getEncodedRootLength } from "./tspath";

export interface ParsedFile extends FileLike {
  // False when the baseline has no section for the file: the text is a stand-in that gives back the printed
  // line and column of every position that the baseline names, and nothing else.
  hasText: boolean;
}

export interface ParsedDiagnostic extends Diagnostic {
  file: ParsedFile | undefined;
  messageChain: ParsedDiagnostic[];
  relatedInformation: ParsedDiagnostic[];
  // As printed: 1-based line and 1-based UTF-16 column. Undefined for a global diagnostic and for a masked position.
  line: number | undefined;
  character: number | undefined;
  // False when the baseline does not give the length of the span (no section, or a related span in the plain format).
  hasLength: boolean;
  // The index in the first section; -1 for chain elements and related information.
  order: number;
}

export interface ParsedBaseline {
  pretty: boolean;
  rules: Rules;
  diagnostics: ParsedDiagnostic[];
  files: TestFile[];
  // Places where the text did not decide and the reader took its default.
  ambiguities: string[];
}

export interface ReadOptions {
  rules?: Rules;
  // The units of the case, when the caller has them: name and content.
  units?: TestFile[];
}

export class BaselineReadError extends Error {}

function fail(message: string): never {
  throw new BaselineReadError(message);
}

const categories: Record<string, Category> = {
  warning: Category.Warning,
  error: Category.Error,
  suggestion: Category.Suggestion,
  message: Category.Message,
};

const headPattern = /^([^]*?)\((\d+|--),(\d+|--)\): (error|warning|suggestion|message) TS(-?\d+): ([^]*)$/;
const globalHeadPattern = /^(error|warning|suggestion|message) TS(-?\d+): ([^]*)$/;
const sectionHeaderPattern = /^==== ([^]*) \((\d+) errors\) ====$/;
const relatedPattern = /^!!! related TS(-?\d+)(?: ([^]*?):(\d+|--):(\d+|--))?: ([^]*)$/;
const comparePathsOptions = { useCaseSensitiveFileNames: false, currentDirectory: "" };

interface Head {
  fileName: string | undefined;
  line: number | undefined;
  character: number | undefined;
  category: Category;
  code: number;
  messageLines: string[];
}

function newDiagnostic(category: Category, code: number, message: string): ParsedDiagnostic {
  return {
    file: undefined,
    pos: 0,
    end: 0,
    code,
    category,
    source: "",
    message,
    messageChain: [],
    relatedInformation: [],
    line: undefined,
    character: undefined,
    hasLength: false,
    order: -1,
  };
}

// The flattened text of a message and its chain: one line per chain element, two spaces per level.
function parseFlattenedMessage(lines: string[], category: Category, code: number): ParsedDiagnostic {
  const root = newDiagnostic(category, code, lines[0]);
  const stack: ParsedDiagnostic[] = [root];
  let last = root;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === " ") spaces++;
    const level = Math.min(spaces >> 1, stack.length);
    if (level === 0) {
      // Not a chain element: the message itself holds a line break.
      last.message += "\r\n" + line;
      continue;
    }
    const node = newDiagnostic(category, code, line.slice(level * 2));
    stack.length = level;
    stack[level - 1].messageChain.push(node);
    stack.push(node);
    last = node;
  }
  return root;
}

// The byte offset of a UTF-16 column. Only TypeScript names a column between the halves of a surrogate pair.
function byteOffsetOfUtf16Column(text: ByteString, from: number, units: number, rules: Rules): number {
  if (rules === "tsc") {
    const pos = tsc.advanceUtf16(text, from, units);
    if (pos === undefined) fail(`column ${units + 1} is outside of the text`);
    return pos;
  }
  let pos = from;
  let n = 0;
  while (n < units && pos < text.length) {
    const [r, size] = decodeRune(text, pos);
    n += r >= 0x10000 ? 2 : 1;
    pos += size;
  }
  if (n !== units) fail(`column ${units + 1} is outside of the text`);
  return pos;
}

// The stand-in for a file that has no section: spaces and line feeds that give back each named line and column.
class StandInFile implements ParsedFile {
  hasText = false;
  text = "";
  ecmaLineMap: number[] | undefined;
  private columns = new Map<number, number>();
  private users: { d: ParsedDiagnostic; line: number; character: number }[] = [];
  constructor(public fileName: string) {}
  use(d: ParsedDiagnostic): void {
    d.file = this;
    d.pos = 0;
    d.end = 0;
    if (d.line === undefined || d.character === undefined) return;
    this.columns.set(d.line, Math.max(this.columns.get(d.line) ?? 0, d.character));
    this.users.push({ d, line: d.line, character: d.character });
  }
  finish(): void {
    let maxLine = 0;
    for (const line of this.columns.keys()) maxLine = Math.max(maxLine, line);
    const starts: number[] = [];
    let text = "";
    for (let line = 1; line <= maxLine; line++) {
      starts.push(text.length);
      text += " ".repeat(Math.max(0, (this.columns.get(line) ?? 1) - 1));
      if (line < maxLine) text += "\n";
    }
    this.text = text;
    for (const { d, line, character } of this.users) {
      d.pos = starts[line - 1] + character - 1;
      d.end = d.pos;
    }
  }
}

interface RuleOps {
  rules: Rules;
  stripPrefixes(text: string): string;
  // What the writer prints in front of the tildes for a span that starts `squiggleStart` bytes into the line.
  squigglePrefix(line: ByteString, squiggleStart: number): ByteString;
  // The number of bytes that `count` tildes cover from `squiggleStart`.
  bytesOfTildes(line: ByteString, squiggleStart: number, count: number): number;
}

const tsgoOps: RuleOps = {
  rules: "tsgo",
  stripPrefixes: text => removeTestPathPrefixes(text, false),
  squigglePrefix(line, squiggleStart) {
    if (squiggleStart > line.length) fail("the span starts after the end of its line, where the Go writer cannot slice");
    return replaceNonWhitespace(line.slice(0, squiggleStart));
  },
  bytesOfTildes(line, squiggleStart, count) {
    let pos = squiggleStart;
    for (let n = 0; n < count; n++) {
      if (pos >= line.length) fail("more tildes than runes on the line");
      pos += decodeRune(line, pos)[1];
    }
    return pos - squiggleStart;
  },
};

const tscOps: RuleOps = {
  rules: "tsc",
  stripPrefixes: tsc.removeTestPathPrefixes,
  squigglePrefix: (line, squiggleStart) => tsc.squiggleInLine(line, squiggleStart, 0),
  bytesOfTildes(line, squiggleStart, count) {
    const pos = tsc.advanceUtf16(line, squiggleStart, count);
    if (pos === undefined) fail("more tildes than UTF-16 code units on the line");
    return pos - squiggleStart;
  },
};

interface Section {
  unitName: string;
  errorCount: number;
  lines: string[];
}

interface MessageBlock {
  next: number;
  related: ParsedDiagnostic[];
  printed: string;
}

// The file name that a line of related information prints, until the files are known.
const relatedFileName = new WeakMap<ParsedDiagnostic, string>();

// The message lines of a diagnostic and its related information, from block[i].
// acceptChainLine is asked about each line that the text alone cannot tell from a line of the file.
function readMessageBlock(ops: RuleOps, block: string[], i: number, d: ParsedDiagnostic, acceptChainLine: (at: number) => boolean, expected?: (number | undefined)[]): MessageBlock {
  const first = i;
  const message = flattenDiagnosticMessage(d, "\r\n");
  for (let line of ops.stripPrefixes(message).split("\n")) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length === 0) continue;
    const expected = `!!! ${categoryName(d.category)} TS${d.code}: ${line}`;
    if (block[i] !== expected) fail(`message line ${JSON.stringify(block[i])} is not ${JSON.stringify(expected)}`);
    i++;
  }
  const related: ParsedDiagnostic[] = [];
  while (i < block.length && block[i].startsWith("!!! related TS")) {
    const m = relatedPattern.exec(block[i]);
    if (m === null) fail(`related line ${JSON.stringify(block[i])}`);
    i++;
    const messageLines = [m[5]];
    let level = 0;
    // The pretty first section prints the message of a related entry with a file: its lines are counted there.
    const known = expected?.[related.length];
    while (i < block.length) {
      const line = block[i];
      if (known !== undefined) {
        if (messageLines.length > known) break;
        messageLines.push(line);
        i++;
        continue;
      }
      if (line.startsWith("!!! ") || line.startsWith("==== ")) break;
      let spaces = 0;
      while (spaces < line.length && line[spaces] === " ") spaces++;
      // A line of the file has four spaces in front; a chain line of the first level has two.
      if (spaces >= 4 && (level === 0 || spaces === line.length || !acceptChainLine(i))) break;
      messageLines.push(line);
      level = Math.max(1, Math.min(spaces >> 1, level + 1));
      i++;
    }
    // The category of related information is not printed.
    const r = parseFlattenedMessage(messageLines, Category.Message, Number(m[1]));
    if (m[2] !== undefined) {
      relatedFileName.set(r, m[2]);
      if (m[3] !== "--") {
        r.line = Number(m[3]);
        r.character = Number(m[4]);
      }
    }
    related.push(r);
  }
  return { next: i, related, printed: block.slice(first, i).join("\r\n") };
}

// Reads a baseline and checks the reading: the writer must give back the bytes.
// Without options.rules the rules of the Go harness are tried first, then those of TypeScript's harness.
export function readErrorBaselineChecked(text: ByteString, options: ReadOptions = {}): ParsedBaseline {
  let firstError: unknown;
  for (const rules of options.rules !== undefined ? [options.rules] : (["tsgo", "tsc"] as Rules[])) {
    try {
      const parsed = readErrorBaseline(text, { ...options, rules });
      const written = getErrorBaseline(parsed.files, parsed.diagnostics, (a, b) => (a as ParsedDiagnostic).order - (b as ParsedDiagnostic).order, parsed.pretty, rules);
      if (written.text === text) return parsed;
      firstError ??= new BaselineReadError(`the writer does not give back the bytes with the rules ${rules}`);
    } catch (e) {
      if (!(e instanceof BaselineReadError) && !(e instanceof RangeError)) throw e;
      firstError ??= e;
    }
  }
  throw firstError;
}

export function readErrorBaseline(text: ByteString, options: ReadOptions = {}): ParsedBaseline {
  const rules = options.rules ?? "tsgo";
  const ops: RuleOps = rules === "tsc" ? tscOps : tsgoOps;
  const pretty = text.startsWith("\u001b[");
  const ambiguities: string[] = [];

  const split = /\r\n\r\n(?===== |!!! )/.exec(text);
  if (split === null) fail("no end of the first section");
  const top = text.slice(0, split.index);
  let rest = text.slice(split.index + 4);

  if (pretty) {
    // The summary is a function of the diagnostics: the reader drops it and the writer makes it again.
    // A baseline without a diagnostic of the category error has no summary.
    const at = rest.lastIndexOf("\r\nFound ");
    if (at >= 0) rest = rest.slice(0, at);
  }

  // The first section.
  const heads: Head[] = [];
  const prettyTops: PrettyTop[] = [];
  if (pretty) {
    for (const p of rules === "tsc" ? readPrettyTopTsc(top) : readPrettyTopTsgo(top)) {
      heads.push(p.head);
      prettyTops.push(p);
    }
  } else {
    if (!top.endsWith("\r\n")) fail("the first section does not end with a line break");
    for (const line of top.slice(0, -2).split("\r\n")) {
      const g = globalHeadPattern.exec(line);
      if (g !== null) {
        heads.push({ fileName: undefined, line: undefined, character: undefined, category: categories[g[1]], code: Number(g[2]), messageLines: [g[3]] });
        continue;
      }
      const m = headPattern.exec(line);
      if (m !== null) {
        const masked = m[2] === "--" || m[3] === "--";
        if (masked && (m[2] !== "--" || m[3] !== "--")) fail("a position that is half masked");
        heads.push({
          fileName: m[1],
          line: masked ? undefined : Number(m[2]),
          character: masked ? undefined : Number(m[3]),
          category: categories[m[4]],
          code: Number(m[5]),
          messageLines: [m[6]],
        });
        continue;
      }
      if (heads.length === 0) fail("the first section starts with a line that is not a diagnostic");
      heads[heads.length - 1].messageLines.push(line);
    }
  }

  const diagnostics: ParsedDiagnostic[] = [];
  const fileNameOf = new Map<ParsedDiagnostic, string>();
  heads.forEach((head, index) => {
    const d = parseFlattenedMessage(head.messageLines, head.category, head.code);
    d.line = head.line;
    d.character = head.character;
    d.order = index;
    if (head.fileName !== undefined) fileNameOf.set(d, head.fileName);
    diagnostics.push(d);
  });

  // The lines after the first section: the global block, then one block per input file.
  const sections: Section[] = [];
  const globalLines: string[] = [];
  for (const line of rest.split("\r\n")) {
    const h = line.startsWith("==== ") ? sectionHeaderPattern.exec(line) : null;
    if (h !== null) {
      sections.push({ unitName: h[1], errorCount: Number(h[2]), lines: [] });
    } else if (sections.length === 0) {
      globalLines.push(line);
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  // The positions of each file that the baseline names: the text of the section must hold every one of them.
  const namedPositions: NamedPosition[] = [];
  for (const head of heads) if (head.fileName !== undefined && head.line !== undefined) namedPositions.push({ fileName: head.fileName, line: head.line, character: head.character! });
  for (const line of rest.split("\r\n")) {
    const m = line.startsWith("!!! related TS") ? relatedPattern.exec(line) : null;
    if (m !== null && m[2] !== undefined && m[3] !== "--") namedPositions.push({ fileName: m[2], line: Number(m[3]), character: Number(m[4]) });
  }
  const minLines = (unitName: string): NamedPosition[] =>
    namedPositions.filter(n => comparePaths(ops.stripPrefixes(n.fileName), ops.stripPrefixes(unitName), comparePathsOptions) === 0);

  const printedBlocks = new Map<ParsedDiagnostic, string>();
  const commit = (d: ParsedDiagnostic, block: MessageBlock): void => {
    const before = printedBlocks.get(d);
    if (before === undefined) {
      d.relatedInformation = block.related;
      printedBlocks.set(d, block.printed);
    } else if (before !== block.printed) {
      fail("two sections print one diagnostic with different messages");
    }
  };

  // In a pretty baseline: per related entry of a diagnostic, the number of lines that follow its first line.
  const expectedRelated = (d: ParsedDiagnostic): (number | undefined)[] | undefined => {
    if (!pretty) return undefined;
    return prettyTops[d.order].related.map(r => (r === undefined ? undefined : r.messageLines.length - 1));
  };

  // Global diagnostics.
  {
    let i = 0;
    for (const d of diagnostics) {
      if (fileNameOf.has(d)) continue;
      const block = readMessageBlock(ops, globalLines, i, d, () => true, expectedRelated(d));
      commit(d, block);
      i = block.next;
    }
    if (i !== globalLines.length) fail(`${globalLines.length - i} lines of the global block are left`);
  }

  // The Go harness names every file with an absolute path and prints it without the prefix of the test roots.
  // A printed name that is relative had such a prefix: the source root for a file with a section, else a library root.
  const fullName = (printed: string, hasSection: boolean): string => {
    if (rules !== "tsgo" || getEncodedRootLength(printed) !== 0) return printed;
    if (hasSection) return "/.src/" + printed;
    return (isDefaultLibraryFile(printed) ? "bundled:///libs/" : "/.lib/") + printed;
  };

  // The sections.
  const usedUnits = new Set<TestFile>();
  const testFiles: TestFile[] = [];
  const sameFile = (a: string, b: string): boolean => comparePaths(ops.stripPrefixes(a), ops.stripPrefixes(b), comparePathsOptions) === 0;
  for (const section of sections) {
    const fileErrors = diagnostics.filter(d => fileNameOf.has(d) && sameFile(fileNameOf.get(d)!, section.unitName));
    if (fileErrors.length !== section.errorCount) {
      fail(`the header of ${section.unitName} counts ${section.errorCount} errors and the first section has ${fileErrors.length}`);
    }
    // Two units can have one name: the section belongs to the first of them that is free and that it reads with.
    const candidates = (options.units ?? []).filter(u => sameFile(u.unitName, section.unitName));
    candidates.sort((a, b) => Number(usedUnits.has(a)) - Number(usedUnits.has(b)));
    let unit: TestFile | undefined;
    let result: SectionResult | undefined;
    let firstError: unknown;
    for (const candidate of candidates) {
      try {
        result = readSection(section, fileErrors, ops, ambiguities, candidate, expectedRelated, minLines(section.unitName));
        unit = candidate;
        usedUnits.add(candidate);
        break;
      } catch (e) {
        if (!(e instanceof BaselineReadError)) throw e;
        firstError ??= e;
      }
    }
    if (result === undefined) {
      if (firstError !== undefined) throw firstError;
      if (options.units !== undefined) ambiguities.push(`${section.unitName}: no unit has this name, the section is read without one`);
      result = readSection(section, fileErrors, ops, ambiguities, undefined, expectedRelated, minLines(section.unitName));
    }
    const content = unit !== undefined ? unit.content : result.content;
    fileErrors.forEach((d, k) => {
      const span = result.spans[k];
      if (printedBlocks.has(d)) {
        if (d.pos !== span.pos || d.end !== span.end) fail("two sections print one diagnostic with different spans");
      } else {
        d.pos = span.pos;
        d.end = span.end;
        d.hasLength = true;
      }
      commit(d, span.block!);
    });
    testFiles.push({ unitName: unit !== undefined ? unit.unitName : fullName(section.unitName, true), content });
  }

  // Files: one object per name, with the text of the first section of that name, else a stand-in.
  const byName = new Map<string, ParsedFile>();
  const standIns: StandInFile[] = [];
  const fileFor = (name: string): ParsedFile => {
    let file = byName.get(name);
    if (file === undefined) {
      const section = testFiles.find(f => sameFile(f.unitName, name));
      if (section !== undefined) {
        // A name that differs from the name of the section in case only keeps its own spelling.
        const sameSpelling = ops.stripPrefixes(section.unitName) === ops.stripPrefixes(name);
        file = { fileName: sameSpelling ? section.unitName : fullName(name, true), text: section.content, hasText: true };
      } else {
        const standIn = new StandInFile(fullName(name, false));
        standIns.push(standIn);
        file = standIn;
      }
      byName.set(name, file);
    }
    return file;
  };
  for (const d of diagnostics) {
    const name = fileNameOf.get(d);
    if (name === undefined) continue;
    const file = fileFor(name);
    if (file instanceof StandInFile) file.use(d);
    else d.file = file;
  }
  for (const d of diagnostics) {
    for (const r of d.relatedInformation) {
      const name = relatedFileName.get(r);
      if (name === undefined) continue;
      const file = fileFor(name);
      if (file instanceof StandInFile) {
        file.use(r);
        continue;
      }
      r.file = file;
      if (r.line === undefined || r.character === undefined) fail("a masked related position in a file that has a section");
      const starts = computeECMALineStarts(file.text);
      if (r.line > starts.length) fail(`related line ${r.line} is outside of ${name}`);
      r.pos = byteOffsetOfUtf16Column(file.text, starts[r.line - 1], r.character - 1, rules);
      r.end = r.pos;
    }
  }
  for (const standIn of standIns) standIn.finish();

  if (pretty) {
    applyPrettyTops(diagnostics, prettyTops, rules);
  }

  return { pretty, rules, diagnostics, files: testFiles, ambiguities };
}

interface NamedPosition {
  fileName: string;
  line: number;
  character: number;
}

interface SectionResult {
  content: ByteString;
  spans: { pos: number; end: number; block: MessageBlock | undefined }[];
  taken: boolean[];
}

// One section: the lines of the file, each followed by the squiggles and messages of the spans that touch it.
// A chain line of related information with four spaces or more looks like a line of the file: the reader tries
// both readings, the chain first, and keeps the first one with which the rest of the section reads.
function readSection(
  section: Section,
  fileErrors: ParsedDiagnostic[],
  ops: RuleOps,
  ambiguities: string[],
  unit: TestFile | undefined,
  expectedRelated: (d: ParsedDiagnostic) => (number | undefined)[] | undefined,
  named: NamedPosition[],
): SectionResult {
  const raw = section.lines;
  const unitLines = unit?.content.split(/\r?\n/).map(l => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const unitLineStarts = unit === undefined ? undefined : computeECMALineStarts(unit.content);
  for (const d of fileErrors) {
    if (d.line === undefined || d.character === undefined) fail(`a masked position in ${section.unitName}, which has a section`);
  }

  // Reads the section with the given decisions for the undecided lines; further ones take the chain reading.
  const attempt = (decisions: boolean[], taken: boolean[]): SectionResult => {
    const contentLines: string[] = [];
    const lineStarts: number[] = [0];
    const state = fileErrors.map(() => 0); // 0 pending, 1 active, 2 done
    const spans = fileErrors.map(() => ({ pos: 0, end: 0, block: undefined as MessageBlock | undefined }));
    let i = 0;
    while (i < raw.length) {
      const rawLine = raw[i];
      if (!rawLine.startsWith("    ")) fail(`line ${JSON.stringify(rawLine)} of ${section.unitName} is neither text nor message`);
      const line = rawLine.slice(4);
      const lineIndex = contentLines.length;
      if (unitLines !== undefined && unitLines[lineIndex] !== line) fail(`line ${lineIndex + 1} of ${section.unitName} is not the line of the unit`);
      if (/\r|\xe2\x80[\xa8\xa9]/.test(line) && state.some((s, k) => s !== 2 && fileErrors[k].line! - 1 >= lineIndex)) {
        fail(`a line break inside line ${lineIndex + 1} of ${section.unitName}, before a span`);
      }
      contentLines.push(line);
      i++;
      const thisLineStart = lineStarts[lineIndex];
      const nextLineStart = unitLineStarts !== undefined && lineIndex + 1 < unitLineStarts.length ? unitLineStarts[lineIndex + 1] : thisLineStart + line.length + 1;
      lineStarts.push(nextLineStart);
      for (let k = 0; k < fileErrors.length; k++) {
        const d = fileErrors[k];
        if (state[k] === 2) continue;
        if (state[k] === 0) {
          if (d.line! - 1 < lineIndex) fail(`the span at line ${d.line} of ${section.unitName} has no squiggle`);
          if (d.line! - 1 !== lineIndex) continue;
          spans[k].pos = byteOffsetOfUtf16Column(line, 0, d.character! - 1, ops.rules) + thisLineStart;
          state[k] = 1;
        }
        const errStart = spans[k].pos;
        const squiggleStart = Math.max(0, errStart - thisLineStart);
        const prefix = ops.squigglePrefix(line, squiggleStart);
        if (i >= raw.length) fail(`the squiggle line of a span is missing in ${section.unitName}`);
        const squiggleLine = raw[i];
        if (!squiggleLine.startsWith("    " + prefix)) fail(`squiggle line ${JSON.stringify(squiggleLine)} does not start at column ${d.character}`);
        const tildes = squiggleLine.slice(4 + prefix.length);
        if (!/^~*$/.test(tildes)) fail(`squiggle line ${JSON.stringify(squiggleLine)} has text after column ${d.character}`);
        i++;
        const covered = ops.bytesOfTildes(line, Math.min(squiggleStart, line.length), tildes.length);
        if (i < raw.length && raw[i].startsWith("!!! ")) {
          // The span ends on this line: at the last tilde, which the end of the line can cut short.
          spans[k].end = Math.max(errStart, thisLineStart) + covered;
          state[k] = 2;
          const accept = (): boolean => {
            const decision = taken.length < decisions.length ? decisions[taken.length] : true;
            taken.push(decision);
            return decision;
          };
          const block = readMessageBlock(ops, raw, i, d, accept, expectedRelated(d));
          spans[k].block = block;
          i = block.next;
        } else if (squiggleStart + covered < line.length) {
          fail(`a span of ${section.unitName} goes on after line ${lineIndex + 1} and its squiggle stops before the end of the line`);
        }
      }
    }
    for (let k = 0; k < fileErrors.length; k++) {
      if (state[k] !== 2) fail(`a span of ${section.unitName} at line ${fileErrors[k].line} has no message`);
    }
    if (unitLines !== undefined && unitLines.length !== contentLines.length) fail(`${section.unitName} has ${contentLines.length} lines and the unit has ${unitLines.length}`);
    for (const n of named) {
      if (n.line > contentLines.length) fail(`${section.unitName} has ${contentLines.length} lines and the baseline names its line ${n.line}`);
      const units = ops.rules === "tsc" ? tsc.utf16Units(contentLines[n.line - 1], 0, contentLines[n.line - 1].length) : utf16Len(contentLines[n.line - 1]);
      if (n.character - 1 > units) fail(`line ${n.line} of ${section.unitName} has ${units} code units and the baseline names its column ${n.character}`);
    }
    return { content: contentLines.join("\n"), spans, taken };
  };

  // Depth-first over the undecided lines.
  const search = (decisions: boolean[]): SectionResult => {
    const taken: boolean[] = [];
    let firstError: unknown;
    try {
      return attempt(decisions, taken);
    } catch (e) {
      if (!(e instanceof BaselineReadError)) throw e;
      firstError = e;
    }
    for (let n = taken.length - 1; n >= decisions.length; n--) {
      try {
        return search([...taken.slice(0, n), false]);
      } catch (e) {
        if (!(e instanceof BaselineReadError)) throw e;
      }
    }
    throw firstError;
  };

  const result = search([]);
  if (result.taken.length > 0 && unit === undefined) {
    ambiguities.push(`${section.unitName}: ${result.taken.length} lines after related information read as ${result.taken.map(t => (t ? "chain" : "text")).join(",")}`);
  }
  return result;
}

interface SnippetRow {
  line: number;
  text: string;
  spaces: number;
  tildes: number;
}

interface PrettyRelated {
  fileName: string;
  line: number;
  character: number;
  messageLines: string[];
  rows: SnippetRow[];
}

interface PrettyTop {
  head: Head;
  // In the order of the list; undefined stands for an entry without a file, of which the Go writer prints a line break.
  related: (PrettyRelated | undefined)[];
  rows: SnippetRow[];
}

const ESC = "\u001b";
const locationPattern = new RegExp(`^${ESC}\\[96m([^]*?)${ESC}\\[0m:${ESC}\\[93m(\\d+)${ESC}\\[0m:${ESC}\\[93m(\\d+)${ESC}\\[0m`);
const categoryPattern = new RegExp(`^${ESC}\\[9[1304]m(error|warning|suggestion|message)${ESC}\\[0m${ESC}\\[90m TS(-?\\d+): ${ESC}\\[0m([^]*)$`);
const gutterPattern = new RegExp(`^( *)${ESC}\\[7m *(\\d+|\\.\\.\\.|)${ESC}\\[0m ([^]*)$`);
const squigglePattern = new RegExp(`^${ESC}\\[9[0-6]m( *)(~*)${ESC}\\[0m$`);

function readSnippet(lines: string[], i: number, indent: string): { next: number; rows: SnippetRow[] } {
  const rows: SnippetRow[] = [];
  while (i < lines.length) {
    const g = gutterPattern.exec(lines[i]);
    if (g === null || g[1] !== indent || g[2] === "") break;
    if (g[2] === "...") {
      if (g[3] !== "") fail(`ellipsis line ${JSON.stringify(lines[i])}`);
      i++;
      continue;
    }
    const s = i + 1 < lines.length ? gutterPattern.exec(lines[i + 1]) : null;
    if (s === null || s[1] !== indent || s[2] !== "") fail(`snippet line ${JSON.stringify(lines[i + 1])}`);
    const q = squigglePattern.exec(s[3]);
    if (q === null) fail(`snippet squiggle ${JSON.stringify(lines[i + 1])}`);
    rows.push({ line: Number(g[2]), text: g[3], spaces: q[1].length, tildes: q[2].length });
    i += 2;
  }
  return { next: i, rows };
}

function readPrettyHead(line: string): Head | undefined {
  let fileName: string | undefined;
  let l: number | undefined;
  let c: number | undefined;
  let restOfLine = line;
  const loc = locationPattern.exec(line);
  if (loc !== null) {
    if (!line.startsWith(" - ", loc[0].length)) return undefined;
    fileName = loc[1];
    l = Number(loc[2]);
    c = Number(loc[3]);
    restOfLine = line.slice(loc[0].length + 3);
  }
  const m = categoryPattern.exec(restOfLine);
  if (m === null) return undefined;
  return { fileName, line: l, character: c, category: categories[m[1]], code: Number(m[2]), messageLines: [m[3]] };
}

// FormatDiagnosticsWithColorAndContext of the Go writer, read with a cursor on the text.
// A related entry without a file prints one line break and nothing else: the count of line breaks tells them.
function readPrettyTopTsgo(top: string): PrettyTop[] {
  const result: PrettyTop[] = [];
  let pos = 0;
  const at = (text: string): boolean => top.startsWith(text, pos);
  const expect = (text: string, what: string): void => {
    if (!at(text)) fail(`pretty first section: no ${what} at byte ${pos}`);
    pos += text.length;
  };
  const lineEnd = (from: number): number => {
    const end = top.indexOf("\r\n", from);
    return end < 0 ? top.length : end;
  };
  const startsHead = (from: number): boolean => readPrettyHead(top.slice(from, lineEnd(from))) !== undefined;
  const startsGutter = (from: number, indent: string): boolean => top.startsWith(indent + ESC + "[7m", from);
  // The lines of a message: it goes on over each line break that a chain line or a line of its own text follows.
  const readMessage = (first: string, indentOfSnippet: string): string[] => {
    const lines = [first];
    while (pos < top.length && at("\r\n")) {
      const next = pos + 2;
      if (next >= top.length || top.startsWith("\r\n", next) || top.startsWith(ESC, next) || top.startsWith("  " + ESC + "[96m", next)) break;
      if (startsGutter(next, indentOfSnippet)) break;
      const end = lineEnd(next);
      lines.push(top.slice(next, end));
      pos = end;
    }
    return lines;
  };
  const readRows = (indent: string): SnippetRow[] => {
    const rows: SnippetRow[] = [];
    while (at("\r\n") && startsGutter(pos + 2, indent)) {
      pos += 2;
      let end = lineEnd(pos);
      let g = gutterPattern.exec(top.slice(pos, end));
      if (g !== null && g[2] === "...") {
        if (g[3] !== "") fail(`ellipsis line at byte ${pos}`);
        pos = end;
        expect("\r\n", "line after the ellipsis");
        end = lineEnd(pos);
        g = gutterPattern.exec(top.slice(pos, end));
      }
      if (g === null || g[1] !== indent || g[2] === "" || g[2] === "...") fail(`snippet line at byte ${pos}`);
      pos = end;
      expect("\r\n", "squiggle line of the snippet");
      end = lineEnd(pos);
      const q = gutterPattern.exec(top.slice(pos, end));
      const tildes = q === null || q[1] !== indent || q[2] !== "" ? null : squigglePattern.exec(q[3]);
      if (tildes === null) fail(`snippet squiggle at byte ${pos}`);
      rows.push({ line: Number(g[2]), text: g[3], spaces: tildes[1].length, tildes: tildes[2].length });
      pos = end;
    }
    return rows;
  };
  while (pos < top.length) {
    if (result.length > 0) expect("\r\n", "line break between two diagnostics");
    const end = lineEnd(pos);
    const head = readPrettyHead(top.slice(pos, end));
    if (head === undefined) fail(`pretty first section: no diagnostic at byte ${pos}`);
    pos = end;
    head.messageLines = readMessage(head.messageLines[0], "");
    const entry: PrettyTop = { head, related: [], rows: [] };
    if (head.fileName !== undefined && head.code !== 1490) {
      expect("\r\n", "line break before the snippet");
      entry.rows = readRows("");
      if (entry.rows.length === 0) fail(`pretty first section: no snippet at byte ${pos}`);
      expect("\r\n", "line break after the snippet");
    }
    for (;;) {
      let breaks = 0;
      while (top.startsWith("\r\n", pos + 2 * breaks)) breaks++;
      const after = pos + 2 * breaks;
      const relatedWithFile = top.startsWith("  " + ESC + "[96m", after);
      // The last line break in front of a diagnostic is the separator; the others are entries without a file.
      const withoutFile = after >= top.length ? breaks : breaks - 1;
      if (breaks === 0 || (!relatedWithFile && after < top.length && !startsHead(after))) break;
      for (let n = 0; n < withoutFile; n++) entry.related.push(undefined);
      pos += 2 * withoutFile;
      if (!relatedWithFile) break;
      expect("\r\n  ", "related entry");
      const loc = locationPattern.exec(top.slice(pos, lineEnd(pos)));
      if (loc === null) fail(`pretty first section: no location at byte ${pos}`);
      pos += loc[0].length;
      expect(" - ", "message of the related entry");
      const first = top.slice(pos, lineEnd(pos));
      pos = lineEnd(pos);
      const messageLines = readMessage(first, "    ");
      const rows = readRows("    ");
      if (rows.length === 0) fail(`pretty first section: no snippet of the related entry at byte ${pos}`);
      expect("\r\n", "line break after the related entry");
      entry.related.push({ fileName: loc[1], line: Number(loc[2]), character: Number(loc[3]), messageLines, rows });
    }
    result.push(entry);
  }
  return result;
}

// formatDiagnosticsWithColorAndContext of TypeScript.
function readPrettyTopTsc(top: string): PrettyTop[] {
  if (!top.endsWith("\r\n")) fail("the first section does not end with a line break");
  const lines = top.slice(0, -2).split("\r\n");
  const result: PrettyTop[] = [];
  let i = 0;
  while (i < lines.length) {
    const head = readPrettyHead(lines[i]);
    if (head === undefined) fail(`pretty line ${JSON.stringify(lines[i])} is not a diagnostic`);
    i++;
    while (i < lines.length && lines[i] !== "" && readPrettyHead(lines[i]) === undefined) head.messageLines.push(lines[i++]);
    const entry: PrettyTop = { head, related: [], rows: [] };
    if (head.fileName !== undefined && head.code !== 1490) {
      if (lines[i] !== "") fail("no empty line before the code snippet");
      i++;
      const snippet = readSnippet(lines, i, "");
      if (snippet.rows.length === 0) fail("no code snippet");
      entry.rows = snippet.rows;
      i = snippet.next;
    }
    if (i < lines.length && lines[i] === "") {
      // The related block: an empty line, then per entry the location, the snippet and the indented message.
      i++;
      while (i < lines.length && lines[i].startsWith(`  ${ESC}[96m`)) {
        const loc = locationPattern.exec(lines[i].slice(2));
        if (loc === null || lines[i].length !== 2 + loc[0].length) fail(`related line ${JSON.stringify(lines[i])}`);
        i++;
        const snippet = readSnippet(lines, i, "    ");
        if (snippet.rows.length === 0) fail("no code snippet of related information");
        i = snippet.next;
        if (i >= lines.length || !lines[i].startsWith("    ")) fail("no message of related information");
        const messageLines = [lines[i++].slice(4)];
        while (i < lines.length && lines[i].startsWith("  ") && !lines[i].startsWith(`  ${ESC}[96m`)) messageLines.push(lines[i++]);
        entry.related.push({ fileName: loc[1], line: Number(loc[2]), character: Number(loc[3]), messageLines, rows: snippet.rows });
      }
    }
    result.push(entry);
  }
  return result;
}

// The end of a span from the rows of its snippet: last line, and the column after the last tilde.
function snippetEnd(rows: SnippetRow[]): { lastLine: number; lastCharacter: number } {
  const last = rows[rows.length - 1];
  return { lastLine: last.line, lastCharacter: rows.length === 1 ? last.spaces + last.tildes : last.tildes };
}

// The spans of related information: the section gives the start, the snippet of the first section gives the end.
function applyPrettyTops(diagnostics: ParsedDiagnostic[], tops: PrettyTop[], rules: Rules): void {
  diagnostics.forEach((d, index) => {
    const top = tops[index];
    if (d.file !== undefined && !d.file.hasText) fail("a pretty baseline with a diagnostic in a file without a section");
    const topWithFile = top.related.filter(r => r !== undefined) as PrettyRelated[];
    const withFile = d.relatedInformation.filter(r => r.file !== undefined);
    if (withFile.length !== topWithFile.length) {
      fail(`the first section has ${topWithFile.length} related entries with a file and the section has ${withFile.length}`);
    }
    if (rules === "tsgo" && top.related.length !== d.relatedInformation.length) {
      fail(`the first section has ${top.related.length} related entries and the section has ${d.relatedInformation.length}`);
    }
    for (let k = 0; k < withFile.length; k++) {
      const r = withFile[k];
      const p = topWithFile[k];
      const file = r.file!;
      if (!file.hasText) fail("related information of a pretty baseline in a file without a section");
      if (r.line !== p.line || r.character !== p.character) fail("the two prints of related information name different positions");
      const starts = computeECMALineStarts(file.text);
      const firstLineChar = utf16Len(file.text.slice(starts[p.line - 1], r.pos));
      let { lastLine, lastCharacter } = snippetEnd(p.rows);
      if (rules === "tsgo" && lastLine === p.line && lastCharacter === firstLineChar + 1) {
        // One tilde is what a span of no length and a span of one code unit both draw.
        // At the end of a line and in front of a code point of two units only the span of no length exists.
        const [next, size] = r.pos < file.text.length ? decodeRune(file.text, r.pos) : [0, 0];
        if (size === 0 || next === 0x0a || next === 0x0d || next >= 0x10000) lastCharacter = firstLineChar;
      }
      // The Go writer draws tildes past the end of a line that ends in white space: the span ends with the line.
      const lineText = file.text.slice(starts[lastLine - 1], lastLine < starts.length ? starts[lastLine] : file.text.length).replace(/[\r\n]+$/, "");
      lastCharacter = Math.min(lastCharacter, utf16Len(lineText));
      r.end = byteOffsetOfUtf16Column(file.text, starts[lastLine - 1], lastCharacter, rules);
      if (r.end < r.pos) r.end = r.pos;
      r.hasLength = true;
    }
  });
}
