// The rules of TypeScript's own harness (src/harness/harnessIO.ts, src/harness/util.ts, src/compiler/program.ts,
// src/compiler/watch.ts at 5848bc5) in the places where they differ from the rules of the Go harness.
// Positions of a Diagnostic stay UTF-8 byte offsets; each function converts where TypeScript counts UTF-16 units.
import type { Diagnostic, FileLike } from "./diagnosticwriter";
import { Category, categoryName, flattenDiagnosticMessage, getECMALineStarts } from "./diagnosticwriter";
import { type ByteString, byteStringToUtf8, decodeRune, padLeft, utf16Len, utf8ToByteString } from "./go_compat";
import { convertToRelativePath } from "./tspath";

// util.ts: /(?:(file:\/{3})|\/)\.(?:ts|lib|src)\//g, replaced by the scheme or by nothing.
const testPathPrefixRegExp = /(?:(file:\/{3})|\/)\.(?:ts|lib|src)\//g;
export function removeTestPathPrefixes(text: string): string {
  return text.replace(testPathPrefixRegExp, (_, scheme) => scheme || "");
}

// JavaScript: `.` excludes LF, CR, U+2028 and U+2029, and `^` with the m flag matches after each of them.
// On a ByteString U+2028 is E2 80 A8 and U+2029 is E2 80 A9.
const notLineTerminator = "(?:[^\\n\\r\\xe2]|\\xe2(?!\\x80[\\xa8\\xa9]))";
export const diagnosticsLocationPrefix = new RegExp(`(?<=^|[\\n\\r]|\\xe2\\x80[\\xa8\\xa9])(lib${notLineTerminator}*\\.d\\.ts)\\(\\d+,\\d+\\)`, "gi");
// harnessIO.ts replaces the first match only: the pattern has no g flag.
export const diagnosticsLocationPattern = new RegExp(`(lib${notLineTerminator}*\\.d\\.ts):\\d+:\\d+`, "i");

// ts.computeLineStarts has the line break set of ComputeECMALineStarts; the offsets here are bytes.
export function computeLineStarts(text: ByteString): number[] {
  return getECMALineStarts({ fileName: "", text });
}

// harnessIO.ts: split on LF, and when that gives one line, split on CR.
export function splitLines(content: ByteString): ByteString[] {
  let lines = content.split("\n");
  if (lines.length === 1) {
    lines = lines[0].split("\r");
  }
  return lines;
}

// JavaScript's \s: the white space and line terminator code points of ECMAScript.
function isJsWhiteSpace(r: number): boolean {
  switch (r) {
    case 0x09:
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x0d:
    case 0x20:
    case 0xa0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
    case 0xfeff:
      return true;
  }
  return r >= 0x2000 && r <= 0x200a;
}

// A position of TypeScript counts UTF-16 code units, and it can fall between the two halves of a surrogate
// pair. As a byte offset that position is the start of the four bytes of the code point plus two.
function isHalf(text: ByteString, pos: number): boolean {
  if (pos < 2 || pos > text.length - 2) return false;
  const lead = text.charCodeAt(pos - 2);
  return lead >= 0xf0 && lead <= 0xf4 && decodeRune(text, pos - 2)[1] === 4;
}

// The number of UTF-16 code units of text[from:to]; both ends can be half positions.
export function utf16Units(text: ByteString, from: number, to: number): number {
  let n = 0;
  let i = from;
  if (i < to && isHalf(text, i)) {
    n++;
    i += 2;
  }
  while (i < to) {
    const [r, size] = decodeRune(text, i);
    if (size === 4 && i + 2 === to) {
      n++;
      break;
    }
    n += r >= 0x10000 ? 2 : 1;
    i += size;
  }
  return n;
}

// The byte offset that is `units` UTF-16 code units after `from`; undefined when the text ends before.
export function advanceUtf16(text: ByteString, from: number, units: number): number | undefined {
  let n = 0;
  let i = from;
  if (n < units && isHalf(text, i)) {
    n++;
    i += 2;
  }
  while (n < units) {
    if (i >= text.length) return undefined;
    const [r, size] = decodeRune(text, i);
    if (r >= 0x10000) {
      if (n + 1 === units) return i + 2;
      n += 2;
    } else {
      n++;
    }
    i += size;
  }
  return i;
}

// line.substr(0, squiggleStart).replace(/\S/g, " ") + new Array(Math.min(length, line.length - squiggleStart) + 1).join("~")
// with squiggleStart and length in UTF-16 code units, as TypeScript counts them.
export function squiggleOfUnits(line: ByteString, squiggleStart: number, length: number): ByteString {
  let out = "";
  let units = 0;
  for (let i = 0; i < line.length && units < squiggleStart; ) {
    const [r, size] = decodeRune(line, i);
    const width = r >= 0x10000 ? 2 : 1;
    if (width === 2 && units + 1 === squiggleStart) {
      // The first half of a surrogate pair alone is not white space.
      out += " ";
      break;
    }
    out += isJsWhiteSpace(r) ? line.slice(i, i + size) : " ".repeat(width);
    units += width;
    i += size;
  }
  const count = Math.min(length, utf16Len(line) - squiggleStart);
  // new Array(n) throws for a negative n: a start two or more past the end of the line.
  if (count + 1 < 0) throw new RangeError("Invalid array length");
  out += "~".repeat(Math.max(0, count));
  return out;
}

// The squiggle line of a span, from byte offsets into the text of the file and the line that the harness shows.
export function squiggle(content: ByteString, line: ByteString, thisLineStart: number, errStart: number, end: number): ByteString {
  const relativeOffset = errStart >= thisLineStart ? utf16Units(content, thisLineStart, errStart) : -utf16Units(content, errStart, thisLineStart);
  const length = utf16Units(content, errStart, end) - Math.max(0, -relativeOffset);
  return squiggleOfUnits(line, Math.max(0, relativeOffset), length);
}

// The same for a span that starts `squiggleStart` bytes into the line that is shown, as the reader meets it.
export function squiggleInLine(line: ByteString, squiggleStart: number, length: number): ByteString {
  const start = utf16Units(line, 0, Math.min(squiggleStart, line.length)) + Math.max(0, squiggleStart - line.length);
  const end = Math.min(line.length, squiggleStart + length);
  return squiggleOfUnits(line, start, squiggleStart + length <= line.length ? utf16Units(line, Math.min(squiggleStart, line.length), end) : utf16Len(line) + 1);
}

// getLineAndCharacterOfPosition: 0-based line and UTF-16 column, for a position that can be a half position.
export function getLineAndCharacterOfPosition(file: FileLike, pos: number): [number, number] {
  const lineMap = getECMALineStarts(file);
  let line = 0;
  for (let i = 0; i < lineMap.length && lineMap[i] <= pos; i++) line = i;
  return [line, utf16Units(file.text, lineMap[line], pos)];
}

// ---- program.ts ----

const gutterStyleSequence = "\u001b[7m";
const gutterSeparator = " ";
const resetEscapeSequence = "\u001b[0m";
const ellipsis = "...";
const halfIndent = "  ";
const indent = "    ";
const Grey = "\u001b[90m";
const Red = "\u001b[91m";
const Yellow = "\u001b[93m";
const Blue = "\u001b[94m";
const Cyan = "\u001b[96m";

const formatOpts = { useCaseSensitiveFileNames: false, currentDirectory: "" };

function getCategoryFormat(category: Category): string {
  switch (category) {
    case Category.Error:
      return Red;
    case Category.Warning:
      return Yellow;
    case Category.Suggestion:
      throw new Error("Should never get an Info diagnostic on the command line.");
    case Category.Message:
      return Blue;
  }
  throw new Error("Unhandled diagnostic category");
}

function formatColorAndReset(text: string, formatStyle: string): string {
  return formatStyle + text + resetEscapeSequence;
}

export function formatLocation(file: FileLike, start: number, color: (text: string, formatStyle: string) => string = formatColorAndReset): string {
  const [firstLine, firstLineChar] = getLineAndCharacterOfPosition(file, start);
  const relativeFileName = convertToRelativePath(file.fileName, formatOpts);
  let output = "";
  output += color(relativeFileName, Cyan);
  output += ":";
  output += color(`${firstLine + 1}`, Yellow);
  output += ":";
  output += color(`${firstLineChar + 1}`, Yellow);
  return output;
}

function formatDiagnostic(diagnostic: Diagnostic, newLine: string): string {
  const errorMessage = `${categoryName(diagnostic.category)} TS${diagnostic.code}: ${flattenDiagnosticMessage(diagnostic, newLine)}${newLine}`;
  if (diagnostic.file !== undefined) {
    const [line, character] = getLineAndCharacterOfPosition(diagnostic.file, diagnostic.pos);
    const relativeFileName = convertToRelativePath(diagnostic.file.fileName, formatOpts);
    return `${relativeFileName}(${line + 1},${character + 1}): ` + errorMessage;
  }
  return errorMessage;
}

// The text of a file as TypeScript holds it, with the byte offset of every UTF-16 code unit.
function utf16View(file: FileLike): { text: string; lineStarts: number[] } {
  const text = byteStringToUtf8(file.text);
  const lineStarts: number[] = [];
  let lineStart = 0;
  for (let pos = 0; pos < text.length; ) {
    const ch = text.charCodeAt(pos);
    pos++;
    if (ch === 0x0d) {
      if (text.charCodeAt(pos) === 0x0a) pos++;
      lineStarts.push(lineStart);
      lineStart = pos;
    } else if (ch === 0x0a || ch === 0x2028 || ch === 0x2029) {
      lineStarts.push(lineStart);
      lineStart = pos;
    }
  }
  lineStarts.push(lineStart);
  return { text, lineStarts };
}

function formatCodeSpan(file: FileLike, start: number, length: number, indent: string, squiggleColor: string, newLine: string): string {
  const [firstLine, firstLineChar] = getLineAndCharacterOfPosition(file, start);
  const [lastLine, lastLineChar] = getLineAndCharacterOfPosition(file, start + length);
  const view = utf16View(file);
  const lastLineInFile = view.lineStarts.length - 1;

  const hasMoreThanFiveLines = lastLine - firstLine >= 4;
  let gutterWidth = (lastLine + 1 + "").length;
  if (hasMoreThanFiveLines) {
    gutterWidth = Math.max(ellipsis.length, gutterWidth);
  }

  let context = "";
  for (let i = firstLine; i <= lastLine; i++) {
    context += newLine;
    if (hasMoreThanFiveLines && firstLine + 1 < i && i < lastLine - 1) {
      context += indent + formatColorAndReset(padLeft(ellipsis, gutterWidth), gutterStyleSequence) + gutterSeparator + newLine;
      i = lastLine - 1;
    }

    const lineStart = view.lineStarts[i];
    const lineEnd = i < lastLineInFile ? view.lineStarts[i + 1] : view.text.length;
    let lineContent = view.text.slice(lineStart, lineEnd);
    lineContent = lineContent.trimEnd(); // trim from end
    lineContent = lineContent.replace(/\t/g, " "); // convert tabs to single spaces

    context += indent + formatColorAndReset(padLeft(i + 1 + "", gutterWidth), gutterStyleSequence) + gutterSeparator;
    context += utf8ToByteString(lineContent) + newLine;

    context += indent + formatColorAndReset(padLeft("", gutterWidth), gutterStyleSequence) + gutterSeparator;
    context += squiggleColor;
    if (i === firstLine) {
      const lastCharForLine = i === lastLine ? lastLineChar : undefined;
      context += utf8ToByteString(lineContent.slice(0, firstLineChar).replace(/\S/g, " "));
      context += lineContent.slice(firstLineChar, lastCharForLine).replace(/./g, "~");
    } else if (i === lastLine) {
      context += lineContent.slice(0, lastLineChar).replace(/./g, "~");
    } else {
      context += lineContent.replace(/./g, "~");
    }
    context += resetEscapeSequence;
  }
  return context;
}

function formatDiagnosticsWithColorAndContext(diagnostics: Diagnostic[], newLine: string): string {
  let output = "";
  for (const diagnostic of diagnostics) {
    if (diagnostic.file !== undefined) {
      output += formatLocation(diagnostic.file, diagnostic.pos);
      output += " - ";
    }

    output += formatColorAndReset(categoryName(diagnostic.category), getCategoryFormat(diagnostic.category));
    output += formatColorAndReset(` TS${diagnostic.code}: `, Grey);
    output += flattenDiagnosticMessage(diagnostic, newLine);

    if (diagnostic.file !== undefined && diagnostic.code !== 1490) {
      output += newLine;
      output += formatCodeSpan(diagnostic.file, diagnostic.pos, diagnostic.end - diagnostic.pos, "", getCategoryFormat(diagnostic.category), newLine);
    }
    if (diagnostic.relatedInformation.length > 0) {
      output += newLine;
      for (const related of diagnostic.relatedInformation) {
        if (related.file !== undefined) {
          output += newLine;
          output += halfIndent + formatLocation(related.file, related.pos);
          output += formatCodeSpan(related.file, related.pos, related.end - related.pos, indent, Cyan, newLine);
        }
        output += newLine;
        output += indent + flattenDiagnosticMessage(related, newLine);
      }
    }
    output += newLine;
  }
  return output;
}

export function minimalDiagnosticsToString(diagnostics: Diagnostic[], pretty: boolean, newLine: string): string {
  if (pretty) return formatDiagnosticsWithColorAndContext(diagnostics, newLine);
  let output = "";
  for (const diagnostic of diagnostics) output += formatDiagnostic(diagnostic, newLine);
  return output;
}

// ---- watch.ts: getErrorCountForSummary, getFilesInErrorForSummary, getErrorSummaryText ----

interface ReportFileInError {
  fileName: string;
  line: number;
}

function getFilesInErrorForSummary(diagnostics: Diagnostic[]): (ReportFileInError | undefined)[] {
  const filesInError = diagnostics.filter(d => d.category === Category.Error).map(d => (d.file === undefined ? undefined : d.file.fileName));
  return filesInError.map(fileName => {
    if (fileName === undefined) return undefined;
    const diagnosticForFileName = diagnostics.find(d => d.file !== undefined && d.file.fileName === fileName);
    if (diagnosticForFileName !== undefined) {
      const [line] = getLineAndCharacterOfPosition(diagnosticForFileName.file!, diagnosticForFileName.pos);
      return { fileName, line: line + 1 };
    }
    return undefined;
  });
}

function prettyPathForFileError(error: ReportFileInError): string {
  const line = formatColorAndReset(":" + error.line, Grey);
  return error.fileName + line;
}

export function getErrorSummaryText(diagnostics: Diagnostic[], newLine: string): string {
  const errorCount = diagnostics.filter(d => d.category === Category.Error).length;
  const filesInError = getFilesInErrorForSummary(diagnostics);
  if (errorCount === 0) return "";
  const nonNilFiles = filesInError.filter(fileInError => fileInError !== undefined) as ReportFileInError[];
  const distinctFileNamesWithLines = nonNilFiles
    .map(fileInError => `${fileInError.fileName}:${fileInError.line}`)
    .filter((value, index, self) => self.indexOf(value) === index);

  const firstFileReference = nonNilFiles[0] && prettyPathForFileError(nonNilFiles[0]);

  let message: string;
  if (errorCount === 1) {
    message = filesInError[0] !== undefined ? `Found 1 error in ${firstFileReference}` : "Found 1 error.";
  } else {
    message =
      distinctFileNamesWithLines.length === 0
        ? `Found ${errorCount} errors.`
        : distinctFileNamesWithLines.length === 1
          ? `Found ${errorCount} errors in the same file, starting at: ${firstFileReference}`
          : `Found ${errorCount} errors in ${distinctFileNamesWithLines.length} files.`;
  }
  const suffix = distinctFileNamesWithLines.length > 1 ? createTabularErrorsDisplay(nonNilFiles) : "";
  return `${newLine}${message}${newLine}${newLine}${suffix}`;
}

function createTabularErrorsDisplay(filesInError: ReportFileInError[]): string {
  const distinctFiles = filesInError.filter((value, index, self) => index === self.findIndex(file => file.fileName === value.fileName));
  if (distinctFiles.length === 0) return "";

  const numberLength = (num: number) => Math.log(num) * Math.LOG10E + 1;
  const fileToErrorCount = distinctFiles.map(file => [file, filesInError.filter(fileInError => fileInError.fileName === file.fileName).length] as const);
  const maxErrors = fileToErrorCount.reduce((acc, value) => Math.max(acc, value[1]), 0);

  const headerRow = "Errors  Files";
  const leftColumnHeadingLength = headerRow.split(" ")[0].length;
  const leftPaddingGoal = Math.max(leftColumnHeadingLength, numberLength(maxErrors));
  const headerPadding = Math.max(numberLength(maxErrors) - leftColumnHeadingLength, 0);

  let tabularData = "";
  tabularData += " ".repeat(headerPadding) + headerRow + "\n";
  for (const [file, errorCount] of fileToErrorCount) {
    const errorCountDigitsLength = (Math.log(errorCount) * Math.LOG10E + 1) | 0;
    const leftPadding = errorCountDigitsLength < leftPaddingGoal ? " ".repeat(leftPaddingGoal - errorCountDigitsLength) : "";
    const fileRef = prettyPathForFileError(file);
    tabularData += `${leftPadding}${errorCount}  ${fileRef}\n`;
  }
  return tabularData;
}
