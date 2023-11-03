// This file is intended to be compatible with "BuiltinExecutableMetadata.h" in JSC.
// That is why the code is written like it's C++.

export interface BuiltinExecutableMetadata {
  startColumn: number;
  endColumn: number;

  functionKeywordStart: number;
  functionNameStart: number;
  parametersStart: number;
  isInStrictContext: boolean;
  isArrowFunctionBodyExpression: boolean;
  isAsyncFunction: boolean;

  asyncOffset: number;
  parameterCount: number;

  lineCount: number;
  offsetOfLastNewline: number;
  positionBeforeLastNewlineLineStartOffset: number;
  closeBraceOffsetFromEnd: number;

  toCpp(): string;
}

function strlen(s) {
  return s.length;
}

export function parseBuiltinExecutable(code: string): BuiltinExecutableMetadata {
  const characters = code;
  const length = code.length;
  let startColumn = 0;
  let endColumn = 0;

  let functionKeywordStart = 0;
  let functionNameStart = 0;
  let parametersStart = 0;
  let isInStrictContext = false;
  let isArrowFunctionBodyExpression = false;
  let isAsyncFunction = false;

  let asyncOffset = 0;
  let parameterCount = 0;

  let lineCount = 0;
  let offsetOfLastNewline = 0;
  let positionBeforeLastNewlineLineStartOffset = 0;
  let closeBraceOffsetFromEnd = 1;

  const regularFunctionBegin = "(function (";
  const asyncFunctionBegin = "(async function (";
  console.assert(length >= strlen("(function (){})"), "Code is too short to be a function");
  isAsyncFunction = length >= strlen("(async function (){})") && characters.startsWith(asyncFunctionBegin, 0);
  console.assert(isAsyncFunction || characters.startsWith(regularFunctionBegin, 0), "Code is not a function");
  asyncOffset = isAsyncFunction ? strlen("async ") : 0;
  parametersStart = strlen("function (") + asyncOffset;
  startColumn = parametersStart;
  functionKeywordStart = strlen("(") + asyncOffset;
  functionNameStart = parametersStart;
  isInStrictContext = false;
  isArrowFunctionBodyExpression = false;

  parameterCount = 0;
  {
    let i = parametersStart + 1;
    let commas = 0;
    let insideCurlyBrackets = false;
    let sawOneParam = false;
    let hasRestParam = false;
    while (true) {
      console.assert(i < length, "Unexpected end of code");
      if (characters[i] == ")") break;

      if (characters[i] == "}") insideCurlyBrackets = false;
      else if (characters[i] == "{" || insideCurlyBrackets) {
        insideCurlyBrackets = true;
        ++i;
        continue;
      } else if (characters[i] == ",") ++commas;
      else if (!isWhiteSpace(characters[i])) sawOneParam = true;

      if (i + 2 < length && characters[i] == "." && characters[i + 1] == "." && characters[i + 2] == ".") {
        hasRestParam = true;
        i += 2;
      }

      ++i;
    }

    if (commas) parameterCount = commas + 1;
    else if (sawOneParam) parameterCount = 1;
    else parameterCount = 0;

    if (hasRestParam) {
      console.assert(parameterCount, "Rest parameter must be preceded by another parameter");
      --parameterCount;
    }
  }

  lineCount = 0;
  endColumn = 0;
  offsetOfLastNewline = 0;

  let offsetOfSecondToLastNewline: number | null = null;

  for (let i = 0; i < length; ++i) {
    if (characters[i] == "\n") {
      if (lineCount) offsetOfSecondToLastNewline = offsetOfLastNewline;
      ++lineCount;
      endColumn = 0;
      offsetOfLastNewline = i;
    } else ++endColumn;

    if (!isInStrictContext && (characters[i] == '"' || characters[i] == "'")) {
      const useStrictLength = strlen("use strict");
      if (i + 1 + useStrictLength < length) {
        if (characters.substring(i + 1).startsWith("use strict")) {
          isInStrictContext = true;
          i += 1 + useStrictLength;
        }
      }
    }
  }

  positionBeforeLastNewlineLineStartOffset = offsetOfSecondToLastNewline !== null ? offsetOfSecondToLastNewline + 1 : 0;
  closeBraceOffsetFromEnd = 1;
  while (true) {
    if (characters[length - closeBraceOffsetFromEnd] == "}") break;
    ++closeBraceOffsetFromEnd;
  }

  return {
    startColumn,
    endColumn,
    functionKeywordStart,
    functionNameStart,
    parametersStart,
    isInStrictContext,
    isArrowFunctionBodyExpression,
    isAsyncFunction,
    asyncOffset,
    parameterCount,
    lineCount,
    offsetOfLastNewline,
    positionBeforeLastNewlineLineStartOffset,
    closeBraceOffsetFromEnd,

    toCpp() {
      return `JSC::BuiltinExecutableMetadata(
        ${this.startColumn},
        ${this.endColumn},
        ${this.functionKeywordStart},
        ${this.functionNameStart},
        ${this.parametersStart},
        ${this.isInStrictContext},
        ${this.isArrowFunctionBodyExpression},
        ${this.isAsyncFunction},
        ${this.asyncOffset},
        ${this.parameterCount},
        ${this.lineCount},
        ${this.offsetOfLastNewline},
        ${this.positionBeforeLastNewlineLineStartOffset},
        ${this.closeBraceOffsetFromEnd}
      )`;
    },
  };
}

// JSC::Lexer<LChar>::isWhiteSpace(LChar)
function isWhiteSpace(ch: string) {
  switch (ch.charCodeAt(0)) {
    case 0x09: // Tab
    case 0x0b: // Vertical tab
    case 0x0c: // Form feed
    case 0x20: // Space
    case 0xa0: // No-break space
    case 0xc: // Byte order mark
      return true;
    default:
      return false;
  }
}
