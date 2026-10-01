// Port of internal/diagnosticwriter/diagnosticwriter.go, with the parts of core.go, scanner.go and
// ast/diagnostic.go that it calls. All text is a ByteString: positions are UTF-8 byte offsets.
import { type ByteString, compareStrings, decodeRune, padLeft, trimRightSpace, utf16Len } from "./go_compat";
import { type ComparePathsOptions, convertToRelativePath, pathIsAbsolute } from "./tspath";

// diagnostics.Category: the numeric value is the sort key of CompareDiagnostics.
export const enum Category {
  Warning = 0,
  Error = 1,
  Suggestion = 2,
  Message = 3,
}

// Category.Name()
export function categoryName(category: Category): string {
  switch (category) {
    case Category.Warning:
      return "warning";
    case Category.Error:
      return "error";
    case Category.Suggestion:
      return "suggestion";
    case Category.Message:
      return "message";
  }
  throw new Error("Unhandled diagnostic category");
}

export interface FileLike {
  fileName: string;
  text: ByteString;
  ecmaLineMap?: number[];
}

export interface Diagnostic {
  file: FileLike | undefined;
  pos: number;
  end: number;
  code: number;
  category: Category;
  // A custom prefix shown before the code instead of "TS" (empty means "TS").
  source: string;
  // The result of Localize: the text of this message alone, without its chain.
  message: ByteString;
  messageChain: Diagnostic[];
  relatedInformation: Diagnostic[];
}

export interface FormattingOptions extends ComparePathsOptions {
  newLine: string;
}

export class Writer {
  private parts: string[] = [];
  write(text: string): void {
    this.parts.push(text);
  }
  toString(): string {
    return this.parts.join("");
  }
}

// ---- core.go ----

// ComputeECMALineStarts: line breaks are LF, CR, CR LF, U+2028 and U+2029.
export function computeECMALineStarts(text: ByteString): number[] {
  const result: number[] = [];
  const textLen = text.length;
  let pos = 0;
  let lineStart = 0;
  while (pos < textLen) {
    const b = text.charCodeAt(pos);
    if (b < 0x80) {
      pos++;
      if (b === 0x0d) {
        if (pos < textLen && text.charCodeAt(pos) === 0x0a) pos++;
        result.push(lineStart);
        lineStart = pos;
      } else if (b === 0x0a) {
        result.push(lineStart);
        lineStart = pos;
      }
    } else {
      const [ch, size] = decodeRune(text, pos);
      pos += size;
      if (ch === 0x2028 || ch === 0x2029) {
        result.push(lineStart);
        lineStart = pos;
      }
    }
  }
  result.push(lineStart);
  return result;
}

// ---- scanner.go ----

export function getECMALineStarts(sourceFile: FileLike): number[] {
  return (sourceFile.ecmaLineMap ??= computeECMALineStarts(sourceFile.text));
}

export function computeLineOfPosition(lineStarts: number[], pos: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const value = lineStarts[middle];
    if (value < pos) low = middle + 1;
    else if (value > pos) high = middle - 1;
    else return middle;
  }
  return low - 1;
}

export function getECMALineOfPosition(sourceFile: FileLike, pos: number): number {
  return computeLineOfPosition(getECMALineStarts(sourceFile), pos);
}

// Returns the 0-based line and the UTF-16 code unit offset from the start of that line.
export function getECMALineAndUTF16CharacterOfPosition(sourceFile: FileLike, pos: number): [number, number] {
  const lineMap = getECMALineStarts(sourceFile);
  const line = computeLineOfPosition(lineMap, pos);
  // Go panics on a slice that ends after the text or that starts before line 0.
  if (line < 0 || pos > sourceFile.text.length) {
    throw new RangeError(`slice bounds out of range [${line < 0 ? "" : lineMap[line]}:${pos}] with length ${sourceFile.text.length}`);
  }
  const character = utf16Len(sourceFile.text.slice(lineMap[line], pos));
  return [line, character];
}

export function getECMAPositionOfLineAndByteOffset(sourceFile: FileLike, line: number, byteOffset: number): number {
  const lineStarts = getECMALineStarts(sourceFile);
  if (line < 0 || line >= lineStarts.length) {
    throw new Error(`Bad line number. Line: ${line}, lineStarts.length: ${lineStarts.length}.`);
  }
  return lineStarts[line] + byteOffset;
}

// ---- ast/diagnostic.go ----

function getDiagnosticPath(d: Diagnostic): string {
  return d.file !== undefined ? d.file.fileName : "";
}

function compareMessageChainSize(c1: Diagnostic[], c2: Diagnostic[]): number {
  let c = c2.length - c1.length;
  if (c !== 0) return c;
  for (let i = 0; i < c1.length; i++) {
    c = compareMessageChainSize(c1[i].messageChain, c2[i].messageChain);
    if (c !== 0) return c;
  }
  return 0;
}

// The reference compares the message arguments; a diagnostic read from text has only the formatted text.
function compareMessageChainContent(c1: Diagnostic[], c2: Diagnostic[]): number {
  for (let i = 0; i < c1.length; i++) {
    let c = compareStrings(c1[i].message, c2[i].message);
    if (c !== 0) return c;
    if (c1[i].messageChain.length > 0) {
      c = compareMessageChainContent(c1[i].messageChain, c2[i].messageChain);
      if (c !== 0) return c;
    }
  }
  return 0;
}

function compareRelatedInfo(r1: Diagnostic[], r2: Diagnostic[]): number {
  let c = r2.length - r1.length;
  if (c !== 0) return c;
  for (let i = 0; i < r1.length; i++) {
    c = compareDiagnostics(r1[i], r2[i]);
    if (c !== 0) return c;
  }
  return 0;
}

// CompareDiagnostics, with the message text in the place of the message key and arguments.
export function compareDiagnostics(d1: Diagnostic, d2: Diagnostic): number {
  if (d1 === d2) return 0;
  let c = compareStrings(getDiagnosticPath(d1), getDiagnosticPath(d2));
  if (c !== 0) return c;
  c = d1.pos - d2.pos;
  if (c !== 0) return c;
  c = d1.end - d2.end;
  if (c !== 0) return c;
  c = d1.code - d2.code;
  if (c !== 0) return c;
  c = d1.category - d2.category;
  if (c !== 0) return c;
  c = compareStrings(d1.source, d2.source);
  if (c !== 0) return c;
  c = compareStrings(d1.message, d2.message);
  if (c !== 0) return c;
  c = compareMessageChainSize(d1.messageChain, d2.messageChain);
  if (c !== 0) return c;
  c = compareMessageChainContent(d1.messageChain, d2.messageChain);
  if (c !== 0) return c;
  return compareRelatedInfo(d1.relatedInformation, d2.relatedInformation);
}

// ---- diagnosticwriter.go ----

const foregroundColorEscapeGrey = "\u001b[90m";
const foregroundColorEscapeRed = "\u001b[91m";
const foregroundColorEscapeYellow = "\u001b[93m";
const foregroundColorEscapeBlue = "\u001b[94m";
const foregroundColorEscapeCyan = "\u001b[96m";

const gutterStyleSequence = "\u001b[7m";
const gutterSeparator = " ";
const resetEscapeSequence = "\u001b[0m";
const ellipsis = "...";

const fileAppearsToBeBinaryCode = 1490;

export function formatDiagnosticsWithColorAndContext(output: Writer, diags: Diagnostic[], formatOpts: FormattingOptions): void {
  if (diags.length === 0) return;
  for (let i = 0; i < diags.length; i++) {
    if (i > 0) output.write(formatOpts.newLine);
    formatDiagnosticWithColorAndContext(output, diags[i], formatOpts);
  }
}

export function formatDiagnosticWithColorAndContext(output: Writer, diagnostic: Diagnostic, formatOpts: FormattingOptions): void {
  if (diagnostic.file !== undefined) {
    writeLocation(output, diagnostic.file, diagnostic.pos, formatOpts, writeWithStyleAndReset);
    output.write(" - ");
  }

  writeWithStyleAndReset(output, categoryName(diagnostic.category), getCategoryFormat(diagnostic.category));
  output.write(`${foregroundColorEscapeGrey} ${diagnosticPrefix(diagnostic)}${diagnostic.code}: ${resetEscapeSequence}`);
  writeFlattenedDiagnosticMessage(output, diagnostic, formatOpts.newLine);

  if (diagnostic.file !== undefined && diagnostic.code !== fileAppearsToBeBinaryCode) {
    output.write(formatOpts.newLine);
    writeCodeSnippet(output, diagnostic.file, diagnostic.pos, diagnostic.end - diagnostic.pos, getCategoryFormat(diagnostic.category), "", formatOpts);
    output.write(formatOpts.newLine);
  }

  if (diagnostic.relatedInformation.length > 0) {
    for (const relatedInformation of diagnostic.relatedInformation) {
      const file = relatedInformation.file;
      if (file !== undefined) {
        output.write(formatOpts.newLine);
        output.write("  ");
        const pos = relatedInformation.pos;
        writeLocation(output, file, pos, formatOpts, writeWithStyleAndReset);
        output.write(" - ");
        writeFlattenedDiagnosticMessage(output, relatedInformation, formatOpts.newLine);
        writeCodeSnippet(output, file, pos, relatedInformation.end - relatedInformation.pos, foregroundColorEscapeCyan, "    ", formatOpts);
      }
      output.write(formatOpts.newLine);
    }
  }
}

function writeCodeSnippet(writer: Writer, sourceFile: FileLike, start: number, length: number, squiggleColor: string, indent: string, formatOpts: FormattingOptions): void {
  const [firstLine, firstLineChar] = getECMALineAndUTF16CharacterOfPosition(sourceFile, start);
  let [lastLine, lastLineChar] = getECMALineAndUTF16CharacterOfPosition(sourceFile, start + length);
  if (length === 0) {
    lastLineChar++; // When length is zero, squiggle the character right after the start position.
  }

  const lastLineOfFile = getECMALineOfPosition(sourceFile, sourceFile.text.length);

  const hasMoreThanFiveLines = lastLine - firstLine >= 4;
  let gutterWidth = String(lastLine + 1).length;
  if (hasMoreThanFiveLines) {
    gutterWidth = Math.max(ellipsis.length, gutterWidth);
  }

  for (let i = firstLine; i <= lastLine; i++) {
    writer.write(formatOpts.newLine);

    // If the error spans over 5 lines, we'll only show the first 2 and last 2 lines,
    // so we'll skip ahead to the second-to-last line.
    if (hasMoreThanFiveLines && firstLine + 1 < i && i < lastLine - 1) {
      writer.write(indent);
      writer.write(gutterStyleSequence);
      writer.write(padLeft(ellipsis, gutterWidth));
      writer.write(resetEscapeSequence);
      writer.write(gutterSeparator);
      writer.write(formatOpts.newLine);
      i = lastLine - 1;
    }

    const lineStart = getECMAPositionOfLineAndByteOffset(sourceFile, i, 0);
    const lineEnd = i < lastLineOfFile ? getECMAPositionOfLineAndByteOffset(sourceFile, i + 1, 0) : sourceFile.text.length;

    let lineContent = trimRightSpace(sourceFile.text.slice(lineStart, lineEnd)); // trim from end
    lineContent = lineContent.replaceAll("\t", " "); // convert tabs to single spaces

    // Output the gutter and the actual contents of the line.
    writer.write(indent);
    writer.write(gutterStyleSequence);
    writer.write(padLeft(String(i + 1), gutterWidth));
    writer.write(resetEscapeSequence);
    writer.write(gutterSeparator);
    writer.write(lineContent);
    writer.write(formatOpts.newLine);

    // Output the gutter and the error span for the line using tildes.
    writer.write(indent);
    writer.write(gutterStyleSequence);
    writer.write(padLeft("", gutterWidth));
    writer.write(resetEscapeSequence);
    writer.write(gutterSeparator);
    writer.write(squiggleColor);
    if (i === firstLine) {
      // If we're on the last line, then limit it to the last character of the last line.
      // Otherwise, we'll just squiggle the rest of the line, giving 'slice' no end position.
      const lastCharForLine = i === lastLine ? lastLineChar : utf16Len(lineContent);

      // Fill with spaces until the first character,
      // then squiggle the remainder of the line.
      writer.write(repeat(" ", firstLineChar));
      writer.write(repeat("~", lastCharForLine - firstLineChar));
    } else if (i === lastLine) {
      // Squiggle until the final character.
      writer.write(repeat("~", lastLineChar));
    } else {
      // Squiggle the entire line.
      writer.write(repeat("~", utf16Len(lineContent)));
    }

    writer.write(resetEscapeSequence);
  }
}

// strings.Repeat panics on a negative count; the port reports it the same way.
function repeat(s: string, count: number): string {
  if (count < 0) throw new Error("strings: negative Repeat count");
  return s.repeat(count);
}

export function flattenDiagnosticMessage(d: Diagnostic, newLine: string): ByteString {
  const output = new Writer();
  writeFlattenedDiagnosticMessage(output, d, newLine);
  return output.toString();
}

export function writeFlattenedDiagnosticMessage(writer: Writer, diagnostic: Diagnostic, newline: string): void {
  writer.write(diagnostic.message);
  for (const chain of diagnostic.messageChain) {
    flattenDiagnosticMessageChain(writer, chain, newline, 1 /*level*/);
  }
}

function flattenDiagnosticMessageChain(writer: Writer, chain: Diagnostic, newLine: string, level: number): void {
  writer.write(newLine);
  for (let i = 0; i < level; i++) {
    writer.write("  ");
  }
  writer.write(chain.message);
  for (const child of chain.messageChain) {
    flattenDiagnosticMessageChain(writer, child, newLine, level + 1);
  }
}

function diagnosticPrefix(diagnostic: Diagnostic): string {
  return diagnostic.source !== "" ? diagnostic.source : "TS";
}

function getCategoryFormat(category: Category): string {
  switch (category) {
    case Category.Error:
      return foregroundColorEscapeRed;
    case Category.Warning:
      return foregroundColorEscapeYellow;
    case Category.Suggestion:
      return foregroundColorEscapeGrey;
    case Category.Message:
      return foregroundColorEscapeBlue;
  }
  throw new Error("Unhandled diagnostic category");
}

export type FormattedWriter = (output: Writer, text: string, formatStyle: string) => void;

export function writeWithStyleAndReset(output: Writer, text: string, formatStyle: string): void {
  output.write(formatStyle);
  output.write(text);
  output.write(resetEscapeSequence);
}

export function writeLocation(output: Writer, file: FileLike, pos: number, formatOpts: FormattingOptions | undefined, writeWithStyleAndReset: FormattedWriter): void {
  const [firstLine, firstChar] = getECMALineAndUTF16CharacterOfPosition(file, pos);
  const relativeFileName = formatOpts !== undefined ? convertToRelativePath(file.fileName, formatOpts) : file.fileName;

  writeWithStyleAndReset(output, relativeFileName, foregroundColorEscapeCyan);
  output.write(":");
  writeWithStyleAndReset(output, String(firstLine + 1), foregroundColorEscapeYellow);
  output.write(":");
  writeWithStyleAndReset(output, String(firstChar + 1), foregroundColorEscapeYellow);
}

interface ErrorSummary {
  totalErrorCount: number;
  globalErrors: Diagnostic[];
  errorsByFile: Map<FileLike, Diagnostic[]>;
  sortedFiles: FileLike[];
}

export function writeErrorSummaryText(output: Writer, allDiagnostics: Diagnostic[], formatOpts: FormattingOptions): void {
  const errorSummary = getErrorSummary(allDiagnostics);
  const totalErrorCount = errorSummary.totalErrorCount;
  if (totalErrorCount === 0) return;

  const firstFile = errorSummary.sortedFiles.length > 0 ? errorSummary.sortedFiles[0] : undefined;
  const firstFileName = prettyPathForFileError(firstFile, firstFile !== undefined ? errorSummary.errorsByFile.get(firstFile)! : [], formatOpts);
  const numErroringFiles = errorSummary.errorsByFile.size;

  let message: string;
  if (totalErrorCount === 1) {
    // Special-case a single error.
    if (errorSummary.globalErrors.length > 0 || firstFileName === "") {
      message = "Found 1 error.";
    } else {
      message = `Found 1 error in ${firstFileName}`;
    }
  } else {
    switch (numErroringFiles) {
      case 0:
        // No file-specific errors.
        message = `Found ${totalErrorCount} errors.`;
        break;
      case 1:
        // One file with errors.
        message = `Found ${totalErrorCount} errors in the same file, starting at: ${firstFileName}`;
        break;
      default:
        // Multiple files with errors.
        message = `Found ${totalErrorCount} errors in ${numErroringFiles} files.`;
    }
  }
  output.write(formatOpts.newLine);
  output.write(message);
  output.write(formatOpts.newLine);
  output.write(formatOpts.newLine);
  if (numErroringFiles > 1) {
    writeTabularErrorsDisplay(output, errorSummary, formatOpts);
    output.write(formatOpts.newLine);
  }
}

function getErrorSummary(diags: Diagnostic[]): ErrorSummary {
  let totalErrorCount = 0;
  const globalErrors: Diagnostic[] = [];
  const errorsByFile = new Map<FileLike, Diagnostic[]>();

  for (const diagnostic of diags) {
    if (diagnostic.category !== Category.Error) continue;

    totalErrorCount++;
    if (diagnostic.file === undefined) {
      globalErrors.push(diagnostic);
    } else {
      let list = errorsByFile.get(diagnostic.file);
      if (list === undefined) errorsByFile.set(diagnostic.file, (list = []));
      list.push(diagnostic);
    }
  }

  // The reference sorts the keys of a map, whose order is random, with an unstable sort.
  const sortedFiles = [...errorsByFile.keys()].sort((a, b) => compareStrings(a.fileName, b.fileName));

  return { totalErrorCount, globalErrors, errorsByFile, sortedFiles };
}

function writeTabularErrorsDisplay(output: Writer, errorSummary: ErrorSummary, formatOpts: FormattingOptions): void {
  const sortedFiles = errorSummary.sortedFiles;

  let maxErrors = 0;
  for (const errorsForFile of errorSummary.errorsByFile.values()) {
    maxErrors = Math.max(maxErrors, errorsForFile.length);
  }

  const headerRow = "Errors  Files";
  const leftColumnHeadingLength = headerRow.split(" ")[0].length;
  const lengthOfBiggestErrorCount = String(maxErrors).length;
  const leftPaddingGoal = Math.max(leftColumnHeadingLength, lengthOfBiggestErrorCount);
  const headerPadding = Math.max(lengthOfBiggestErrorCount - leftColumnHeadingLength, 0);

  output.write(" ".repeat(headerPadding));
  output.write(headerRow);
  output.write(formatOpts.newLine);

  for (const file of sortedFiles) {
    const fileErrors = errorSummary.errorsByFile.get(file)!;
    const errorCount = fileErrors.length;

    output.write(padLeft(String(errorCount), leftPaddingGoal) + "  ");
    output.write(prettyPathForFileError(file, fileErrors, formatOpts));
    output.write(formatOpts.newLine);
  }
}

function prettyPathForFileError(file: FileLike | undefined, fileErrors: Diagnostic[], formatOpts: FormattingOptions): string {
  if (file === undefined || fileErrors.length === 0) return "";
  const line = getECMALineOfPosition(file, fileErrors[0].pos);
  let fileName = file.fileName;
  if (pathIsAbsolute(fileName) && pathIsAbsolute(formatOpts.currentDirectory)) {
    fileName = convertToRelativePath(file.fileName, formatOpts);
  }
  return `${fileName}${foregroundColorEscapeGrey}:${line + 1}${resetEscapeSequence}`;
}

export function writeFormatDiagnostics(output: Writer, diagnostics: Diagnostic[], formatOpts: FormattingOptions): void {
  for (const diagnostic of diagnostics) {
    writeFormatDiagnostic(output, diagnostic, formatOpts);
  }
}

export function writeFormatDiagnostic(output: Writer, diagnostic: Diagnostic, formatOpts: FormattingOptions): void {
  if (diagnostic.file !== undefined) {
    const [line, character] = getECMALineAndUTF16CharacterOfPosition(diagnostic.file, diagnostic.pos);
    const fileName = diagnostic.file.fileName;
    const relativeFileName = convertToRelativePath(fileName, formatOpts);
    output.write(`${relativeFileName}(${line + 1},${character + 1}): `);
  }

  output.write(`${categoryName(diagnostic.category)} ${diagnosticPrefix(diagnostic)}${diagnostic.code}: `);
  writeFlattenedDiagnosticMessage(output, diagnostic, formatOpts.newLine);
  output.write(formatOpts.newLine);
}
