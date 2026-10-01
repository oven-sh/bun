// Prototype: the plain diagnostic format of WriteFormatDiagnostic as a command line prints it, read back from stderr.
export type CategoryName = "error" | "warning" | "suggestion" | "message";

export interface PlainChain {
  messageText: string;
  messageChain: PlainChain[];
}

export interface PlainDiagnostic {
  // as printed; undefined for a diagnostic without a file
  path: string | undefined;
  // 1-based, column in UTF-16 code units; 0 when path is undefined
  line: number;
  column: number;
  category: CategoryName;
  // "TS2322" or a rule name, as printed
  codeText: string;
  // the number after TS; undefined for a rule name
  code: number | undefined;
  messageText: string;
  messageChain: PlainChain[];
  // 1-based line of stderr where the head is
  stderrLine: number;
}

export type PlainParse =
  | { ok: true; diagnostics: PlainDiagnostic[] }
  | { ok: false; stderrLine: number; text: string; reason: string };

const codeToken = "[A-Za-z@][A-Za-z0-9@/_-]*";
const globalHead = new RegExp(`^(error|warning|suggestion|message) (${codeToken}): (.*)$`, "s");
const locatedHead = new RegExp(`^(.+?)\\((\\d+),(\\d+)\\): (error|warning|suggestion|message) (${codeToken}): (.*)$`, "s");
const chainLine = /^((?:  )+)(\S.*)$/s;
const tsCode = /^TS(-?\d+)$/;

export function parsePlainDiagnostics(stderr: string): PlainParse {
  const diagnostics: PlainDiagnostic[] = [];
  if (stderr.length === 0) return { ok: true, diagnostics };
  if (!stderr.endsWith("\n")) {
    const at = stderr.lastIndexOf("\n") + 1;
    return { ok: false, stderrLine: stderr.split("\n").length, text: stderr.slice(at), reason: "the last line has no line end" };
  }
  const lines = stderr.slice(0, -1).split("\n");
  // open chain lists by depth: stack[d] is the list that a line of depth d + 1 is appended to
  let stack: PlainChain[][] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const fail = (reason: string): PlainParse => ({ ok: false, stderrLine: i + 1, text: line, reason });
    if (line.includes("\r")) return fail("carriage return inside a line");
    let m = chainLine.exec(line);
    if (m !== null) {
      const depth = m[1].length / 2;
      if (stack.length === 0) return fail("chain line without a diagnostic before it");
      if (depth > stack.length) return fail(`chain line of depth ${depth} after depth ${stack.length - 1}`);
      const node: PlainChain = { messageText: m[2], messageChain: [] };
      stack[depth - 1].push(node);
      stack = stack.slice(0, depth);
      stack.push(node.messageChain);
      continue;
    }
    let path: string | undefined;
    let lineNumber = 0;
    let column = 0;
    let category: string;
    let codeText: string;
    let text: string;
    if ((m = globalHead.exec(line)) !== null) {
      [, category, codeText, text] = m;
    } else if ((m = locatedHead.exec(line)) !== null) {
      path = m[1];
      lineNumber = Number(m[2]);
      column = Number(m[3]);
      [, , , , category, codeText, text] = m;
      if (lineNumber < 1 || column < 1) return fail("line and column are 1-based");
    } else {
      return fail("neither a diagnostic nor a chain line");
    }
    const c = tsCode.exec(codeText);
    const d: PlainDiagnostic = {
      path,
      line: lineNumber,
      column,
      category: category as CategoryName,
      codeText,
      code: c === null ? undefined : Number(c[1]),
      messageText: text,
      messageChain: [],
      stderrLine: i + 1,
    };
    diagnostics.push(d);
    stack = [d.messageChain];
  }
  return { ok: true, diagnostics };
}

function writeChain(chain: PlainChain[], newLine: string, level: number): string {
  let out = "";
  for (const c of chain) {
    out += newLine + "  ".repeat(level) + c.messageText + writeChain(c.messageChain, newLine, level + 1);
  }
  return out;
}

// WriteFormatDiagnostic with the line and column as given and the name as given.
export function writePlainDiagnostic(d: PlainDiagnostic, name: string | undefined, newLine: string): string {
  let out = "";
  if (name !== undefined) out += `${name}(${d.line},${d.column}): `;
  out += `${d.category} ${d.codeText}: ${d.messageText}`;
  out += writeChain(d.messageChain, newLine, 1);
  return out + newLine;
}

// ECMAScript line starts of a JavaScript string: LF, CR, CR LF, U+2028, U+2029.
export function computeLineStartsUtf16(text: string): number[] {
  const result: number[] = [];
  let pos = 0;
  let lineStart = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    pos++;
    if (ch === 0x0d) {
      if (text.charCodeAt(pos) === 0x0a) pos++;
      result.push(lineStart);
      lineStart = pos;
    } else if (ch === 0x0a || ch === 0x2028 || ch === 0x2029) {
      result.push(lineStart);
      lineStart = pos;
    }
  }
  result.push(lineStart);
  return result;
}

// Offset in UTF-16 code units of a 1-based line and column; undefined when the text has no such position.
export function utf16OffsetOfLineAndColumn(text: string, lineStarts: number[], line: number, column: number): number | undefined {
  if (line < 1 || line > lineStarts.length || column < 1) return undefined;
  const start = lineStarts[line - 1];
  const limit = line < lineStarts.length ? lineStarts[line] : text.length;
  const pos = start + column - 1;
  return pos <= limit ? pos : undefined;
}

// Bytes of the UTF-8 form of text[0:utf16Offset]; undefined inside a surrogate pair.
export function utf8OffsetOfUtf16Offset(text: string, utf16Offset: number): number | undefined {
  if (utf16Offset > 0 && utf16Offset < text.length) {
    const before = text.charCodeAt(utf16Offset - 1);
    const at = text.charCodeAt(utf16Offset);
    if (before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff) return undefined;
  }
  return Buffer.byteLength(text.slice(0, utf16Offset), "utf8");
}
