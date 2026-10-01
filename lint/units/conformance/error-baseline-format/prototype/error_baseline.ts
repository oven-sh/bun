// Port of internal/testutil/tsbaseline/error_baseline.go and util.go (the writer of .errors.txt baselines).
import {
  Category,
  type Diagnostic,
  type FileLike,
  type FormattingOptions,
  Writer,
  categoryName,
  computeECMALineStarts,
  flattenDiagnosticMessage,
  formatDiagnosticsWithColorAndContext,
  writeErrorSummaryText,
  writeFormatDiagnostics,
  writeLocation,
} from "./diagnosticwriter";
import { type ByteString, replaceNonWhitespace, runeCount } from "./go_compat";
import * as tsc from "./tsc_rules";
import { comparePaths, ensureTrailingDirectorySeparator, getBaseFileName } from "./tspath";

// harnessutil.TestFile
export interface TestFile {
  unitName: string;
  content: ByteString;
}

// Which harness wrote the baseline: the rules differ in the places that tsc_rules.ts lists.
export type Rules = "tsgo" | "tsc";

export const harnessNewLine = "\r\n";

const formatOpts: FormattingOptions = {
  newLine: harnessNewLine,
  useCaseSensitiveFileNames: false,
  currentDirectory: "",
};

export const noContent = "<no content>";

// ---- util.go ----

const lineDelimiter = /\r?\n/;
const libFolder = "built/local/";
const builtFolder = "/.ts";

// strings.NewReplacer: leftmost match, and at one position the first pattern in argument order.
const testPathPrefixPattern =
  /\/\.ts\/|\/\.lib\/|\/\.src\/|bundled:\/\/\/libs\/|file:\/\/\/\.\/ts\/|file:\/\/\/\.\/lib\/|file:\/\/\/\.\/src\//g;

export function removeTestPathPrefixes(text: string, retainTrailingDirectorySeparator: boolean): string {
  return text.replace(testPathPrefixPattern, match => {
    if (match.startsWith("file:")) return "file:///";
    return retainTrailingDirectorySeparator ? "/" : "";
  });
}

export function isDefaultLibraryFile(filePath: string): boolean {
  const fileName = getBaseFileName(filePath);
  return fileName.startsWith("lib.") && fileName.endsWith(".d.ts");
}

export function isBuiltFile(filePath: string): boolean {
  return filePath.startsWith(libFolder) || filePath.startsWith(ensureTrailingDirectorySeparator(builtFolder));
}

export function isTsConfigFile(path: string): boolean {
  return path.includes("tsconfig") && path.includes("json");
}

// ---- error_baseline.go ----

// (?im)^(lib.*\.d\.ts)\(\d+,\d+\) : in RE2 `.` excludes LF only and `^` matches after LF only.
const diagnosticsLocationPrefix = /(?<![^\n])(lib[^\n]*\.d\.ts)\(\d+,\d+\)/gi;
// (?i)(lib.*\.d\.ts):\d+:\d+
const diagnosticsLocationPattern = /(lib[^\n]*\.d\.ts):\d+:\d+/gi;

export interface ErrorBaselineResult {
  text: ByteString;
  // The pieces of the text: first section, global block, one per input file, and the summary when pretty.
  parts: ByteString[];
  // The checks that the reference makes with assert.Check: a failure marks the test and the text is still made.
  failedChecks: string[];
}

export function minimalDiagnosticsToString(diagnostics: Diagnostic[], pretty: boolean): string {
  const output = new Writer();
  if (pretty) {
    formatDiagnosticsWithColorAndContext(output, diagnostics, formatOpts);
  } else {
    writeFormatDiagnostics(output, diagnostics, formatOpts);
  }
  return output.toString();
}

export function getErrorBaseline(
  inputFiles: TestFile[],
  diagnostics: Diagnostic[],
  compareDiagnostics: (a: Diagnostic, b: Diagnostic) => number,
  pretty: boolean,
  rules: Rules = "tsgo",
): ErrorBaselineResult {
  const failedChecks: string[] = [];
  const outputLines = iterateErrorBaseline(inputFiles, diagnostics, compareDiagnostics, pretty, rules, failedChecks);

  if (pretty) {
    if (rules === "tsc") {
      outputLines.push(tsc.removeTestPathPrefixes(tsc.getErrorSummaryText(diagnostics, harnessNewLine)));
    } else {
      const summaryBuilder = new Writer();
      writeErrorSummaryText(summaryBuilder, diagnostics, formatOpts);
      const summary = removeTestPathPrefixes(summaryBuilder.toString(), false);
      outputLines.push(summary);
    }
  }
  return { text: outputLines.join(""), parts: outputLines, failedChecks };
}

function iterateErrorBaseline(
  inputFiles: TestFile[],
  inputDiagnostics: Diagnostic[],
  compareDiagnostics: (a: Diagnostic, b: Diagnostic) => number,
  pretty: boolean,
  rules: Rules,
  failedChecks: string[],
): string[] {
  const isTsc = rules === "tsc";
  const stripPrefixes = isTsc ? tsc.removeTestPathPrefixes : (text: string) => removeTestPathPrefixes(text, false);
  const diagnostics = stableSort(inputDiagnostics, compareDiagnostics);

  let outputLines = "";
  // Count up all errors that were found in files other than lib.d.ts so we don't miss any
  let totalErrorsReportedInNonLibraryNonTsconfigFiles = 0;
  let errorsReported = 0;

  let firstLine = true;

  const newLine = (): string => {
    if (firstLine) {
      firstLine = false;
      return "";
    }
    return "\r\n";
  };

  const result: string[] = [];

  const outputErrorText = (diag: Diagnostic): void => {
    const message = flattenDiagnosticMessage(diag, harnessNewLine);

    const errLines: string[] = [];
    for (let line of stripPrefixes(message).split("\n")) {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) continue;
      errLines.push(`!!! ${categoryName(diag.category)} TS${diag.code}: ${line}`);
    }

    for (const info of diag.relatedInformation) {
      let location = "";
      if (info.file !== undefined) {
        location = " " + (isTsc ? tsc.formatLocation(info.file, info.pos, text => text) : formatLocation(info.file, info.pos, formatOpts));
      }
      location = stripPrefixes(location);
      if (location.length > 0 && isDefaultLibraryFile(info.file!.fileName)) {
        location = isTsc
          ? location.replace(tsc.diagnosticsLocationPattern, "$1:--:--")
          : location.replace(diagnosticsLocationPattern, "$1:--:--");
      }
      errLines.push(`!!! related TS${info.code}${location}: ${flattenDiagnosticMessage(info, harnessNewLine)}`);
    }

    for (const e of errLines) {
      outputLines += newLine();
      outputLines += e;
    }

    errorsReported++;

    // do not count errors from lib.d.ts here, they are computed separately as numLibraryDiagnostics
    if (diag.file === undefined || (!isDefaultLibraryFile(diag.file.fileName) && !isTsConfigFile(diag.file.fileName))) {
      totalErrorsReportedInNonLibraryNonTsconfigFiles++;
    }
  };

  let topDiagnostics = isTsc ? tsc.minimalDiagnosticsToString(diagnostics, pretty, harnessNewLine) : minimalDiagnosticsToString(diagnostics, pretty);
  topDiagnostics = stripPrefixes(topDiagnostics);
  topDiagnostics = topDiagnostics.replace(isTsc ? tsc.diagnosticsLocationPrefix : diagnosticsLocationPrefix, "$1(--,--)");

  result.push(topDiagnostics + harnessNewLine + harnessNewLine);

  // Report global errors
  for (const error of diagnostics) {
    if (error.file === undefined) {
      outputErrorText(error);
    }
  }

  result.push(outputLines);
  outputLines = "";
  errorsReported = 0;

  // 'merge' the lines of each input file with any errors associated with it
  const dupeCase = new Map<string, number>();
  for (const inputFile of inputFiles) {
    // Filter down to the errors in the file
    const fileErrors = diagnostics.filter(
      e =>
        e.file !== undefined &&
        comparePaths(stripPrefixes(e.file.fileName), stripPrefixes(inputFile.unitName), {
          useCaseSensitiveFileNames: false,
          currentDirectory: "",
        }) === 0,
    );

    // Header
    outputLines += `${newLine()}==== ${stripPrefixes(inputFile.unitName)} (${fileErrors.length} errors) ====`;

    // Make sure we emit something for every error
    let markedErrorCount = 0;
    // For each line, emit the line followed by any error squiggles matching this line

    const lineStarts = isTsc ? tsc.computeLineStarts(inputFile.content) : computeECMALineStarts(inputFile.content);
    const lines = isTsc ? tsc.splitLines(inputFile.content) : inputFile.content.split(lineDelimiter);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      let line = lines[lineIndex];
      if (line.length > 0 && line[line.length - 1] === "\r") {
        line = line.slice(0, line.length - 1);
      }

      const thisLineStart = lineStarts[lineIndex];
      let nextLineStart: number;
      // On the last line of the file, fake the next line start number so that we handle errors on the last character of the file correctly
      if (lineIndex === lines.length - 1) {
        nextLineStart = inputFile.content.length;
      } else {
        nextLineStart = lineStarts[lineIndex + 1];
      }
      // Emit this line from the original file
      outputLines += newLine();
      outputLines += "    ";
      outputLines += line;
      for (const errDiagnostic of fileErrors) {
        // Does any error start or continue on to this line? Emit squiggles
        const errStart = errDiagnostic.pos;
        const end = errDiagnostic.end;
        if (end >= thisLineStart && (errStart < nextLineStart || lineIndex === lines.length - 1)) {
          // How many characters from the start of this line the error starts at (could be positive or negative)
          const relativeOffset = errStart - thisLineStart;
          // How many characters of the error are on this line (might be longer than this line in reality)
          const length = end - errStart - Math.max(0, thisLineStart - errStart);
          // Calculate the start of the squiggle
          const squiggleStart = Math.max(0, relativeOffset);
          outputLines += newLine();
          outputLines += "    ";
          if (isTsc) {
            outputLines += tsc.squiggle(inputFile.content, line, thisLineStart, errStart, end);
          } else {
            if (squiggleStart > line.length) {
              throw new RangeError(`slice bounds out of range [:${squiggleStart}] with length ${line.length}`);
            }
            outputLines += replaceNonWhitespace(line.slice(0, squiggleStart));
            const squiggleEnd = Math.max(squiggleStart, Math.min(squiggleStart + length, line.length));
            outputLines += "~".repeat(runeCount(line.slice(squiggleStart, squiggleEnd)));
          }
          // If the error ended here, or we're at the end of the file, emit its message
          if (lineIndex === lines.length - 1 || nextLineStart > end) {
            outputErrorText(errDiagnostic);
            markedErrorCount++;
          }
        }
      }
    }

    // Verify we didn't miss any errors in this file
    if (markedErrorCount !== fileErrors.length) {
      failedChecks.push(`count of errors in ${inputFile.unitName}: ${markedErrorCount} != ${fileErrors.length}`);
    }
    const isDupe = dupeCase.has(sanitizeTestFilePath(inputFile.unitName));
    result.push(outputLines);
    if (isDupe) {
      totalErrorsReportedInNonLibraryNonTsconfigFiles -= errorsReported;
    }
    outputLines = "";
    errorsReported = 0;
  }

  const numLibraryDiagnostics = diagnostics.filter(
    d => d.file !== undefined && (isDefaultLibraryFile(d.file.fileName) || isBuiltFile(d.file.fileName)),
  ).length;
  const numTsconfigDiagnostics = diagnostics.filter(d => d.file !== undefined && isTsConfigFile(d.file.fileName)).length;
  // Verify we didn't miss any errors in total
  if (totalErrorsReportedInNonLibraryNonTsconfigFiles + numLibraryDiagnostics + numTsconfigDiagnostics !== diagnostics.length) {
    failedChecks.push(
      `total number of errors: ${totalErrorsReportedInNonLibraryNonTsconfigFiles} + ${numLibraryDiagnostics} + ${numTsconfigDiagnostics} != ${diagnostics.length}`,
    );
  }

  return result;
}

function formatLocation(file: FileLike, pos: number, formatOpts: FormattingOptions): string {
  const output = new Writer();
  writeLocation(output, file, pos, formatOpts, (output, text) => output.write(text));
  return output.toString();
}

const testPathCharacters = /[\^<>:"|?*%]/g;
const testPathDotDot = /\.\.\//g;

// The reference ends with tspath.ToPath(path, "", false): the key is the normalized path in lower case.
export function sanitizeTestFilePath(name: string): string {
  let path = name.replace(testPathCharacters, "_");
  path = path.replaceAll("\\", "/");
  path = path.replace(testPathDotDot, "__dotdot/");
  path = path.toLowerCase();
  return path.startsWith("/") ? path.slice(1) : path;
}

// slices.SortFunc is not stable; Array.prototype.sort is, which keeps the input order of equal elements.
function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare);
}

export { Category };
