// Finds the top-level functions of a bundled internal module so that InternalModuleRegistry.cpp can fill JSC's
// SourceProviderCache before the module is parsed. The parser then skips their bodies until they are called.

type TokenKind =
  | "identifier"
  | "keyword"
  | "punctuator"
  | "number"
  | "string"
  | "regexp"
  | "template"
  | "templateHead"
  | "templateMiddle"
  | "templateTail";

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
}

export interface LazyFunction {
  parametersStart: number;
  closeBrace: number;
  parameterCount: number;
  containsTaggedTemplate: boolean;
}

export interface LazyFunctionTable {
  capturedNames: { start: number; length: number }[];
  functions: LazyFunction[];
  capturedNamesOwner: number;
}

const keywords = new Set(
  "break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with".split(
    " ",
  ),
);
const keywordsBeforeExpression = new Set(
  "case delete do else in instanceof new return throw typeof void yield await of".split(" "),
);
const keywordsBeforeParenthesizedCondition = new Set(["if", "while", "for", "with"]);
const punctuators = [
  ">>>=",
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  ">>>",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "**",
];
const identifierStart = /[A-Za-z_$@#]/;
const identifierPart = /[A-Za-z0-9_$@]/;
const numberPattern = /0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/y;

function isPropertyName(tokens: Token[], index: number) {
  const previous = tokens[index - 1]?.text;
  return previous === "." || previous === "?.";
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const brackets: { text: string; regexpAllowedAfterClose: boolean }[] = [];
  let regexpAllowedAfterLastClose = false;
  let i = 0;

  const push = (kind: TokenKind, start: number, end: number) => {
    tokens.push({ kind, start, end, text: source.slice(start, end) });
  };

  const regexpAllowed = () => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    switch (previous.kind) {
      case "identifier":
      case "keyword":
        return keywordsBeforeExpression.has(previous.text) && !isPropertyName(tokens, tokens.length - 1);
      case "punctuator":
        if (previous.text === ")") return regexpAllowedAfterLastClose;
        return previous.text !== "]" && previous.text !== "}" && previous.text !== "++" && previous.text !== "--";
      case "templateHead":
      case "templateMiddle":
        return true;
      default:
        return false;
    }
  };

  const scanTemplateCharacters = (start: number, opensWith: "`" | "}") => {
    let j = start + 1;
    for (;;) {
      if (j >= source.length) throw new Error(`unterminated template at ${start}`);
      const c = source[j];
      if (c === "\\") j += 2;
      else if (c === "`") {
        push(opensWith === "`" ? "template" : "templateTail", start, j + 1);
        return j + 1;
      } else if (c === "$" && source[j + 1] === "{") {
        push(opensWith === "`" ? "templateHead" : "templateMiddle", start, j + 2);
        brackets.push({ text: "${", regexpAllowedAfterClose: false });
        return j + 2;
      } else j++;
    }
  };

  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\r") {
      i++;
    } else if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      push("string", i, j + 1);
      i = j + 1;
    } else if (c === "`") {
      i = scanTemplateCharacters(i, "`");
    } else if (c === "}" && brackets[brackets.length - 1]?.text === "${") {
      brackets.pop();
      i = scanTemplateCharacters(i, "}");
    } else if (c === "/" && regexpAllowed()) {
      let j = i + 1;
      let inClass = false;
      for (; inClass || source[j] !== "/"; j++) {
        if (source[j] === "\n" || j >= source.length) throw new Error(`unterminated regular expression at ${i}`);
        if (source[j] === "\\") j++;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
      }
      j++;
      while (identifierPart.test(source[j])) j++;
      push("regexp", i, j);
      i = j;
    } else if (identifierStart.test(c)) {
      let j = i + 1;
      while (j < source.length && identifierPart.test(source[j])) j++;
      const text = source.slice(i, j);
      push(keywords.has(text) ? "keyword" : "identifier", i, j);
      i = j;
    } else if ((c >= "0" && c <= "9") || (c === "." && source[i + 1] >= "0" && source[i + 1] <= "9")) {
      numberPattern.lastIndex = i;
      const match = numberPattern.exec(source);
      if (!match) throw new Error(`bad number at ${i}`);
      push("number", i, i + match[0].length);
      i += match[0].length;
    } else {
      const text = punctuators.find(p => source.startsWith(p, i)) ?? c;
      if (text === "(" || text === "[" || text === "{") {
        const previous = tokens[tokens.length - 1];
        brackets.push({
          text,
          regexpAllowedAfterClose:
            text === "(" && previous?.kind === "keyword" && keywordsBeforeParenthesizedCondition.has(previous.text),
        });
      } else if (text === ")" || text === "]" || text === "}") {
        const open = brackets.pop();
        if (!open || open.text !== { ")": "(", "]": "[", "}": "{" }[text])
          throw new Error(`unbalanced ${text} at ${i}`);
        regexpAllowedAfterLastClose = open.regexpAllowedAfterClose;
      }
      push("punctuator", i, i + text.length);
      i += text.length;
    }
  }
  if (brackets.length) throw new Error("unbalanced brackets at the end of the source");
  return tokens;
}

function opensBracket(token: Token) {
  return token.kind === "templateHead" || (token.kind === "punctuator" && "([{".includes(token.text));
}

function closesBracket(token: Token) {
  return token.kind === "templateTail" || (token.kind === "punctuator" && ")]}".includes(token.text));
}

function matchBrackets(tokens: Token[]): Int32Array {
  const match = new Int32Array(tokens.length).fill(-1);
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    if (opensBracket(token)) stack.push(index);
    else if (closesBracket(token)) {
      const open = stack.pop()!;
      match[open] = index;
      match[index] = open;
    }
  });
  return match;
}

function isVariableReference(tokens: Token[], index: number) {
  const token = tokens[index];
  if (token.kind !== "identifier" || token.text[0] === "@" || token.text[0] === "#") return false;
  if (token.text === "arguments" || token.text === "eval") return false;
  return !isPropertyName(tokens, index);
}

function countParameters(tokens: Token[], match: Int32Array, open: number) {
  const close = match[open];
  let count = 0;
  let index = open + 1;
  while (index < close) {
    if (tokens[index].text === "...") return count;
    for (; index < close && tokens[index].text !== ","; index++) {
      if (tokens[index].text === "=") return count;
      if (opensBracket(tokens[index])) index = match[index];
    }
    count++;
    index++;
  }
  return count;
}

const modulePrefix = '(function (){"use strict";';

export function findLazyFunctions(source: string): LazyFunctionTable | null {
  if (!source.startsWith(modulePrefix)) return null;
  const tokens = tokenize(source);
  const match = matchBrackets(tokens);
  const bodyOpen = 4;
  if (tokens[bodyOpen].text !== "{" || match[bodyOpen] !== tokens.length - 2)
    throw new Error("unexpected module wrapper");

  const functions: (LazyFunction & { expressionName: string | null })[] = [];
  const namesOutside = new Map<string, number>();
  const namesInside = new Set<string>();

  let arrowBodyEnd = -1;
  for (let index = bodyOpen + 1; index < match[bodyOpen]; index++) {
    const token = tokens[index];

    if (token.text === "=>" && token.kind === "punctuator" && tokens[index + 1].text !== "{") {
      let end = index + 1;
      while (!closesBracket(tokens[end]) && tokens[end].text !== "," && tokens[end].text !== ";")
        end = opensBracket(tokens[end]) ? match[end] + 1 : end + 1;
      arrowBodyEnd = Math.max(arrowBodyEnd, end);
    }

    if (token.kind === "punctuator" && token.text === "(") {
      const isLoopHead = tokens[index - 1].text === "for" || tokens[index - 1].text === "await";
      const isArrowParameters = tokens[match[index] + 1].text === "=>";
      if (isLoopHead || isArrowParameters) {
        for (let inner = index; inner <= match[index]; inner++)
          if (isVariableReference(tokens, inner) && !namesOutside.has(tokens[inner].text))
            namesOutside.set(tokens[inner].text, tokens[inner].start);
        index = match[index];
        continue;
      }
    }

    const isClassKeyword = token.kind === "keyword" && token.text === "class" && !isPropertyName(tokens, index);
    if ((token.kind === "punctuator" && token.text === "{") || token.kind === "templateHead" || isClassKeyword) {
      let open = index;
      while (tokens[open].text !== "{" && tokens[open].kind !== "templateHead")
        open = opensBracket(tokens[open]) ? match[open] + 1 : open + 1;
      for (let inner = index; inner <= match[open]; inner++)
        if (isVariableReference(tokens, inner) && !namesOutside.has(tokens[inner].text))
          namesOutside.set(tokens[inner].text, tokens[inner].start);
      index = match[open];
      continue;
    }

    const isFunctionKeyword = token.kind === "keyword" && token.text === "function" && !isPropertyName(tokens, index);
    if (isFunctionKeyword) {
      let cursor = index + 1;
      const isGenerator = tokens[cursor].text === "*";
      if (isGenerator) cursor++;
      const isAsync = tokens[index - 1].kind === "identifier" && tokens[index - 1].text === "async";
      let name: Token | null = null;
      if (tokens[cursor].text !== "(") name = tokens[cursor++];
      const parametersOpen = cursor;
      if (tokens[parametersOpen].text !== "(")
        throw new Error(`expected parameters at ${tokens[parametersOpen].start}`);
      const functionBodyOpen = match[parametersOpen] + 1;
      if (tokens[functionBodyOpen].text !== "{")
        throw new Error(`expected a body at ${tokens[functionBodyOpen].start}`);
      const functionBodyClose = match[functionBodyOpen];

      const previous = tokens[index - (isAsync ? 2 : 1)];
      const isDeclaration =
        previous.text === ";" || previous.text === "}" || previous.text === "{" || previous.kind === "string";
      if (name && isDeclaration && !namesOutside.has(name.text)) namesOutside.set(name.text, name.start);

      const isSkippable =
        !isGenerator &&
        !isAsync &&
        index > arrowBodyEnd &&
        tokens[functionBodyClose].start - tokens[parametersOpen].start > 16;
      if (!isSkippable) {
        for (let inner = parametersOpen; inner <= functionBodyClose; inner++)
          if (isVariableReference(tokens, inner) && !namesOutside.has(tokens[inner].text))
            namesOutside.set(tokens[inner].text, tokens[inner].start);
        index = functionBodyClose;
        continue;
      }

      let containsTaggedTemplate = false;
      for (let inner = parametersOpen; inner <= functionBodyClose; inner++) {
        if (isVariableReference(tokens, inner)) namesInside.add(tokens[inner].text);
        const kind = tokens[inner].kind;
        if (kind === "template" || kind === "templateHead") {
          const before = tokens[inner - 1];
          if (
            before.kind === "identifier" ||
            before.kind === "template" ||
            before.kind === "templateTail" ||
            before.text === ")" ||
            before.text === "]" ||
            before.text === "this" ||
            before.text === "super"
          )
            containsTaggedTemplate = true;
        }
      }
      functions.push({
        parametersStart: tokens[parametersOpen].start,
        closeBrace: tokens[functionBodyClose].start,
        parameterCount: countParameters(tokens, match, parametersOpen),
        containsTaggedTemplate,
        expressionName: name && !isDeclaration ? name.text : null,
      });
      index = functionBodyClose;
      continue;
    }

    if (isVariableReference(tokens, index) && !namesOutside.has(token.text)) namesOutside.set(token.text, token.start);
  }

  if (!functions.length) return null;
  const capturedNames = [...namesOutside]
    .filter(([name]) => namesInside.has(name))
    .map(([name, start]) => ({ start, length: name.length }))
    .sort((a, b) => a.start - b.start);
  const captured = new Set(capturedNames.map(({ start, length }) => source.slice(start, start + length)));
  const capturedNamesOwner = functions.findIndex(fn => fn.expressionName === null || !captured.has(fn.expressionName));
  if (capturedNamesOwner < 0) return null;

  for (const fn of functions) {
    const text = source.slice(fn.parametersStart, fn.closeBrace + 1).replaceAll("@", "$");
    let parsed: Function;
    try {
      parsed = new Function(`"use strict"; return function ${text}`)();
    } catch (error) {
      throw new Error(`lazy function at ${fn.parametersStart} does not parse on its own: ${error}`);
    }
    if (parsed.length !== fn.parameterCount)
      throw new Error(
        `lazy function at ${fn.parametersStart} has ${parsed.length} parameters, not ${fn.parameterCount}`,
      );
  }

  return {
    capturedNames,
    functions: functions.map(({ expressionName, ...fn }) => fn),
    capturedNamesOwner,
  };
}

export function encodeLazyFunctionTable(table: LazyFunctionTable | null): number[] {
  const bytes: number[] = [];
  if (!table) return bytes;
  const writeVarint = (value: number) => {
    if (value < 0) throw new Error("negative value in the lazy function table");
    for (; value >= 0x80; value >>>= 7) bytes.push((value & 0x7f) | 0x80);
    bytes.push(value);
  };
  writeVarint(table.capturedNames.length);
  let previous = 0;
  for (const { start, length } of table.capturedNames) {
    writeVarint(start - previous);
    writeVarint(length);
    previous = start;
  }
  writeVarint(table.functions.length);
  writeVarint(table.capturedNamesOwner);
  previous = 0;
  for (const fn of table.functions) {
    writeVarint(fn.parametersStart - previous);
    writeVarint(fn.closeBrace - fn.parametersStart);
    writeVarint((fn.parameterCount << 1) | (fn.containsTaggedTemplate ? 1 : 0));
    previous = fn.closeBrace;
  }
  return bytes;
}
