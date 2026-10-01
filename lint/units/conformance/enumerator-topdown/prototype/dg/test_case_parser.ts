import { skipTrivia } from "./scanner";
import { toLower, trimSpace, trimSuffix } from "./stringutil";
import { getBaseFileName } from "./tspath";

const lineDelimiter = /\r?\n/;
// Go's \s is [\t\n\f\r ] and Go's \w is [0-9A-Za-z_]; a line holds no LF, so (?m)^ is the start of the line.
const optionRegexLine = /^\/{2}[\t\n\f\r ]*@([0-9A-Za-z_]+)[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)/;
const linkRegexLine = /^\/{2}[\t\n\f\r ]*@link[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)[\t\n\f\r ]*->[\t\n\f\r ]*([^\r\n]*)/;
// On a whole text Go's (?m)^ matches at the start and after LF only.
const optionRegexText = /(?<![^\n])\/{2}[\t\n\f\r ]*@([0-9A-Za-z_]+)[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)/g;

export type RawCompilerSettings = Map<string, string>;

export interface TestUnit {
  content: string;
  name: string;
}

export interface TestCaseContent {
  testUnitData: TestUnit[];
  tsConfigFileUnitData: TestUnit | undefined;
  symlinks: Map<string, string>;
  currentDirectory: string;
  globalOptions: Map<string, string>;
}

export type MakeUnitsResult = { ok: true; value: TestCaseContent } | { ok: false; reason: string };

const fourslashDirectives = ["emitthisfile", "noopen"];

export const srcFolder = "/.src";

export function getConfigNameFromFileName(filename: string): string {
  const basenameLower = toLower(getBaseFileName(filename));
  if (basenameLower === "tsconfig.json" || basenameLower === "jsconfig.json") {
    return basenameLower;
  }
  return "";
}

export function makeUnitsFromTest(code: string, fileName: string): MakeUnitsResult {
  const parsed = parseTestFilesAndSymlinks<TestUnit>(code, fileName, (filename, content) => ({
    value: { content, name: filename },
    error: undefined,
  }));
  if (!parsed.ok) return parsed;
  let { units: testUnits, currentDirectory } = parsed;
  if (currentDirectory === "") {
    currentDirectory = srcFolder;
  }
  let tsConfigFileUnitData: TestUnit | undefined;
  for (let i = 0; i < testUnits.length; i++) {
    const data = testUnits[i];
    if (getConfigNameFromFileName(data.name) !== "") {
      tsConfigFileUnitData = data;
      testUnits = testUnits.slice(0, i).concat(testUnits.slice(i + 1));
      break;
    }
  }
  return {
    ok: true,
    value: {
      testUnitData: testUnits,
      tsConfigFileUnitData,
      symlinks: parsed.symlinks,
      currentDirectory,
      globalOptions: parsed.globalOptions,
    },
  };
}

export interface ParseTestFilesOptions {
  allowImplicitFirstFile: boolean;
}

export type ParseFile<T> = (
  filename: string,
  content: string,
  fileOptions: Map<string, string>,
) => { value: T; error: string | undefined };

export type ParseTestFilesResult<T> =
  | {
      ok: true;
      units: T[];
      symlinks: Map<string, string>;
      currentDirectory: string;
      globalOptions: Map<string, string>;
      error: string | undefined;
    }
  | { ok: false; reason: string };

export const counters = { reachedSkipTrivia: 0 };

export function parseTestFilesAndSymlinks<T>(code: string, fileName: string, parseFile: ParseFile<T>) {
  return parseTestFilesAndSymlinksWithOptions(code, fileName, parseFile, { allowImplicitFirstFile: false });
}

const encoder = new TextEncoder();

export function parseTestFilesAndSymlinksWithOptions<T>(
  code: string,
  fileName: string,
  parseFile: ParseFile<T>,
  options: ParseTestFilesOptions,
): ParseTestFilesResult<T> {
  // List of all the subfiles we've parsed out
  const testUnits: T[] = [];

  const lines = code.split(lineDelimiter);

  // Stuff related to the subfile we're parsing
  let currentFileContent = "";
  let currentFileName = "";
  let seenContentLine = false;
  let hasSeenFile = false;
  if (options.allowImplicitFirstFile) {
    currentFileName = fileName;
  }
  let currentDirectory = "";
  let parseError: string | undefined;
  let currentFileOptions = new Map<string, string>();
  const symlinks = new Map<string, string>();
  const globalOptions = new Map<string, string>();

  for (const line of lines) {
    const ok = parseSymlinkFromTest(line, symlinks);
    if (ok) {
      continue;
    }
    const testMetaData = optionRegexLine.exec(line);
    if (testMetaData !== null) {
      // Comment line, check for global/file @options and record them
      const metaDataName = testMetaData[1].toLowerCase();
      const metaDataValue = trimSpace(testMetaData[2]);
      if (metaDataName === "currentdirectory") {
        currentDirectory = metaDataValue;
      }
      if (metaDataName !== "filename") {
        if (metaDataName === "symlink" && currentFileName !== "") {
          for (let link of metaDataValue.split(",")) {
            link = trimSpace(link);
            if (link !== "") {
              symlinks.set(link, currentFileName);
            }
          }
        } else if (fourslashDirectives.includes(metaDataName)) {
          // File-specific option
          currentFileOptions.set(metaDataName, metaDataValue);
        } else {
          // Global option
          globalOptions.set(metaDataName, metaDataValue);
        }
        continue;
      }

      // New metadata statement after having collected some code to go with the previous metadata
      if (currentFileName !== "") {
        // Store result file - always save for regular tests, but skip empty implicit first file for fourslash
        const shouldSaveFile = !options.allowImplicitFirstFile || currentFileContent.length !== 0 || hasSeenFile;
        if (shouldSaveFile) {
          hasSeenFile = true;
          const { value, error } = parseFile(currentFileName, currentFileContent, currentFileOptions);
          if (error !== undefined) {
            parseError = error;
            break;
          }
          testUnits.push(value);
        }

        // Reset local data
        currentFileContent = "";
        seenContentLine = false;
        currentFileName = metaDataValue;
        currentFileOptions = new Map();
      } else {
        // First metadata marker in the file
        let hasContentBeforeFirstFilename = false;
        if (currentFileContent.length !== 0) {
          counters.reachedSkipTrivia++;
          const bytes = encoder.encode(currentFileContent);
          hasContentBeforeFirstFilename = skipTrivia(bytes, 0) !== bytes.length;
        }
        if (hasContentBeforeFirstFilename && !options.allowImplicitFirstFile) {
          return { ok: false, reason: "Non-comment test content appears before the first '// @Filename' directive" };
        }

        // Reset for the new file
        currentFileContent = "";
        seenContentLine = false;
        currentFileName = trimSpace(testMetaData[2]);
        currentFileOptions = new Map();
      }
    } else {
      // Subfile content line
      if (options.allowImplicitFirstFile) {
        if (seenContentLine) {
          currentFileContent += "\n";
        }
        seenContentLine = true;
      } else {
        if (currentFileContent.length !== 0) {
          currentFileContent += "\n";
        }
      }
      currentFileContent += line;
    }
  }

  // normalize the fileName for the single file case
  if (testUnits.length === 0 && currentFileName.length === 0) {
    currentFileName = getBaseFileName(fileName);
  }

  // if there are no parse errors so far, parse the rest of the file
  if (parseError === undefined) {
    // EOF, push whatever remains
    const { value, error } = parseFile(currentFileName, currentFileContent, currentFileOptions);
    parseError = error;
    testUnits.push(value);
  }

  return { ok: true, units: testUnits, symlinks, currentDirectory, globalOptions, error: parseError };
}

export function extractCompilerSettings(content: string): RawCompilerSettings {
  const opts: RawCompilerSettings = new Map();
  for (const match of content.matchAll(optionRegexText)) {
    opts.set(match[1].toLowerCase(), trimSuffix(trimSpace(match[2]), ";"));
  }
  return opts;
}

export function parseSymlinkFromTest(line: string, symlinks: Map<string, string>): boolean {
  const linkMetaData = linkRegexLine.exec(line);
  if (linkMetaData === null) {
    return false;
  }
  symlinks.set(trimSpace(linkMetaData[2]), trimSpace(linkMetaData[1]));
  return true;
}

