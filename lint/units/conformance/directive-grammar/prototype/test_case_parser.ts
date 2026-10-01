import { trimSpace, trimSuffix } from "./go_strings";
import { getConfigNameFromFileName } from "./harnessutil";
import type { Result } from "./result";
import { skipTrivia } from "./scanner";
import { getBaseFileName } from "./tspath";

const lineDelimiter = /\r?\n/;

// This maps a compiler setting, in lower case, to its value as written in the test file.
export type RawCompilerSettings = Map<string, string>;

// All the necessary information to turn a multi file test into useful units for later compilation
export interface TestUnit {
  content: string;
  name: string;
}

export interface TestCaseContent {
  testUnitData: TestUnit[];
  tsConfigFileUnitData: TestUnit | undefined;
  symlinks: Map<string, string>;
  // The two fields below replace the reference's parsed tsConfig: they are the inputs of that parse.
  currentDirectory: string;
  globalOptions: Map<string, string>;
}

// Go's \s is [\t\n\f\r ] and Go's \w is [0-9A-Za-z_]; a line holds no LF, so (?m)^ is the start of the line.
const optionRegexLine = /^\/{2}[\t\n\f\r ]*@([0-9A-Za-z_]+)[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)/;
const linkRegexLine = /^\/{2}[\t\n\f\r ]*@link[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)[\t\n\f\r ]*->[\t\n\f\r ]*([^\r\n]*)/;
// On a whole text Go's (?m)^ matches at the start and after LF only.
const optionRegexText = /(?<![^\n])\/{2}[\t\n\f\r ]*@([0-9A-Za-z_]+)[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)/g;

// File-specific directives used by fourslash tests
const fourslashDirectives = ["emitthisfile", "noopen"];

// Posix-style path to sources under test
export const srcFolder = "/.src";

// Given a test file containing // @FileName directives, return the named units of code.
export function makeUnitsFromTest(code: string, fileName: string): Result<TestCaseContent> {
  const parsed = parseTestFilesAndSymlinks<TestUnit>(code, fileName, (filename, content) => ({
    value: { content, name: filename },
    error: undefined,
  }));
  if (!parsed.ok) {
    return parsed;
  }
  const testUnits = parsed.value.units;
  let currentDirectory = parsed.value.currentDirectory;
  if (currentDirectory === "") {
    currentDirectory = srcFolder;
  }

  // check if project has tsconfig.json in the list of files
  let tsConfigFileUnitData: TestUnit | undefined;
  for (let i = 0; i < testUnits.length; i++) {
    const data = testUnits[i];
    if (getConfigNameFromFileName(data.name) !== "") {
      tsConfigFileUnitData = data;
      // delete tsconfig file entry from the list
      testUnits.splice(i, 1);
      break;
    }
  }

  return {
    ok: true,
    value: {
      testUnitData: testUnits,
      tsConfigFileUnitData,
      symlinks: parsed.value.symlinks,
      currentDirectory,
      globalOptions: parsed.value.globalOptions,
    },
  };
}

export interface ParseTestFilesOptions {
  // If true, content before the first @Filename directive goes into an implicit first file named fileName.
  allowImplicitFirstFile: boolean;
}

export type ParseFile<T> = (
  filename: string,
  content: string,
  fileOptions: Map<string, string>,
) => { value: T; error: string | undefined };

export interface ParsedTestFiles<T> {
  units: T[];
  symlinks: Map<string, string>;
  currentDirectory: string;
  globalOptions: Map<string, string>;
  error: string | undefined;
}

export function parseTestFilesAndSymlinks<T>(
  code: string,
  fileName: string,
  parseFile: ParseFile<T>,
): Result<ParsedTestFiles<T>> {
  return parseTestFilesAndSymlinksWithOptions(code, fileName, parseFile, { allowImplicitFirstFile: false });
}

const utf8 = new TextEncoder();

export function parseTestFilesAndSymlinksWithOptions<T>(
  code: string,
  fileName: string,
  parseFile: ParseFile<T>,
  options: ParseTestFilesOptions,
): Result<ParsedTestFiles<T>> {
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
          const newTestFile = parseFile(currentFileName, currentFileContent, currentFileOptions);
          if (newTestFile.error !== undefined) {
            parseError = newTestFile.error;
            break;
          }
          testUnits.push(newTestFile.value);
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
          const bytes = utf8.encode(currentFileContent);
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
      // Subfile content line: compiler tests drop leading blank lines, fourslash tests keep them.
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
    const newTestFile2 = parseFile(currentFileName, currentFileContent, currentFileOptions);
    parseError = newTestFile2.error;
    testUnits.push(newTestFile2.value);
  }

  return { ok: true, value: { units: testUnits, symlinks, currentDirectory, globalOptions, error: parseError } };
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
