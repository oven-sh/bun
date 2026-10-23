import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { engineBuiltinSources, exportedNameOf, functionBounds } from "./collect-runtime-functions.ts";
import { GeneratorError, Problems, type SourcedDeclaration } from "./declarations.ts";
import type { ModelEngineFile } from "./model.ts";
import { compareBytes } from "./paths.ts";
import { readCMakeList } from "./support.ts";

type TokenGroups = Readonly<Record<string, string | undefined>>;

const tableListFile = "aot/builtins/AOTBuiltinTable.cmake";
const modelListName = "JavaScriptCore_AOT_BUILTIN_TABLE_MODEL_FUNCTIONS";
const handwrittenDirectory = "aot/builtins/handwritten";

const privateNamePrefix = "$";
const symbolKeyPrefix = "$$";

const skippedText = [
  String.raw`//[^\n]*`,
  String.raw`/\*.*?\*/`,
  String.raw`"(?:\\.|[^"\\\n])*"`,
  String.raw`'(?:\\.|[^'\\\n])*'`,
  "`(?:\\\\.|[^`\\\\])*`",
].join("|");

const tokenPattern = new RegExp(
  [
    `(?<skipped>${skippedText})`,
    String.raw`^@(?<annotation>\w+)(?:=(?<value>[^\n]*))?$`,
    String.raw`^(?<head>(?:async\s+)?function\s+)(?<declared>\w+)(?=\s*\()`,
    String.raw`@@(?<literalKey>\w+)(?=\s*:)`,
    String.raw`\b(?<emptyDeclaration>(?:var|let|const)\s+\w+)(?=\s*=\s*(?<emptyLiteral>\[\]|\{\})\s*;)`,
    String.raw`@@(?<symbol>\w+)`,
    String.raw`@(?<name>\w+)`,
  ].join("|"),
  "gms",
);
const deletePattern = new RegExp(
  [skippedText, String.raw`\bdelete[ \t]+(?<base>\w+)\[(?<key>\w+)\]`, String.raw`(?<other>\bdelete\b)`].join("|"),
  "gs",
);
const headPunctuationPattern = new RegExp(`${skippedText}|[(){]`, "gs");
const leadingCommentPattern = /\s*\/\*.*?\*\//sy;
const blanksAndCommentsPattern = /(?:\s|\/\/[^\n]*|\/\*.*?\*\/)*/sy;
const directivePattern = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')[ \t]*(?:;|$)/msy;

function matchAt(stickyPattern: RegExp, text: string, position: number): RegExpExecArray | null {
  stickyPattern.lastIndex = position;
  return stickyPattern.exec(text);
}

function replaceTokens(text: string, pattern: RegExp, respell: (token: string, groups: TokenGroups) => string): string {
  return text.replace(pattern, (token: string, ...rest: unknown[]) => respell(token, rest.at(-1) as TokenGroups));
}

function isStrict(body: string): boolean {
  let position = 1;
  for (;;) {
    const blanks = matchAt(blanksAndCommentsPattern, body, position);
    const directive = matchAt(directivePattern, body, position + (blanks?.[0].length ?? 0));
    if (directive === null) return false;
    if (directive[1].slice(1, -1) === "use strict") return true;
    position = directive.index + directive[0].length;
  }
}

function findBodyStart(functionText: string, name: string): number {
  let depth = 0;
  let hasParameterList = false;
  for (const { 0: token, index } of functionText.matchAll(headPunctuationPattern)) {
    if (token === "(") {
      depth++;
      hasParameterList = true;
    } else if (token === ")") {
      depth--;
    } else if (token === "{" && hasParameterList && depth === 0) {
      return index;
    }
  }
  throw new GeneratorError(`the function ${name} has no body`);
}

function rewriteDeleteInSloppyFunction(functionText: string, name: string): string {
  const bodyStart = findBodyStart(functionText, name);
  const body = functionText.slice(bodyStart);
  if (isStrict(body)) return functionText;
  const rewritten = replaceTokens(body, deletePattern, (token, { base, key, other }) => {
    if (other !== undefined) {
      throw new GeneratorError(
        `the function ${name} has no "use strict", where the only \`delete\` that is supported is \`delete x[y]\``,
      );
    }
    if (base === undefined) return token;
    return `${privateNamePrefix}deleteByValSloppy(${base}, ${key}, ${privateNamePrefix}ecmaModeSloppy)`;
  });
  return functionText.slice(0, bodyStart) + rewritten;
}

function directiveOf(annotation: string, value: string | undefined): string {
  if (value === undefined || value === "") return `${privateNamePrefix}${annotation};`;
  return `${privateNamePrefix}${annotation} = ${value.startsWith('"') ? value : `"${value}"`};`;
}

function exportedHeadOf(head: string, name: string): string {
  const exportedName = exportedNameOf(name);
  const directive = exportedName === name ? "" : `${directiveOf("overriddenName", name)} `;
  return `${directive}export ${head}${exportedName}`;
}

function respellToken(token: string, groups: TokenGroups): string {
  const { skipped, annotation, value, head, declared, literalKey, emptyDeclaration, emptyLiteral, symbol, name } =
    groups;
  if (skipped !== undefined) return token;
  if (annotation !== undefined) return directiveOf(annotation, value);
  if (head !== undefined && declared !== undefined) return exportedHeadOf(head, declared);
  // The checker knows an object with such a member as iterable only where the key is written as TypeScript writes it.
  if (literalKey !== undefined) return `[Symbol.${literalKey}]`;
  // The text has no types. What begins empty would be a list of nothing, or an object without a member, for good.
  if (emptyDeclaration !== undefined) return `${emptyDeclaration}: ${emptyLiteral === "[]" ? "any[]" : "any"}`;
  if (symbol !== undefined) return `${symbolKeyPrefix}${symbol}`;
  return `${privateNamePrefix}${name}`;
}

export function deriveEngineSource(text: string, excludedFunctions: ReadonlySet<string>): string {
  let position = matchAt(leadingCommentPattern, text, 0)?.[0].length ?? 0;
  let kept = text.slice(0, position);
  for (const { start, end, name } of functionBounds(text)) {
    kept += excludedFunctions.has(name)
      ? text.slice(position, end).replace(/[^\n]/g, "")
      : text.slice(position, start) + rewriteDeleteInSloppyFunction(text.slice(start, end), name);
    position = end;
  }
  return replaceTokens(kept + text.slice(position), tokenPattern, respellToken);
}

function deriveEngineFile(
  object: string,
  text: string,
  excludedFunctions: ReadonlySet<string>,
  problems: Problems,
): ModelEngineFile[] {
  try {
    if (functionBounds(text).every(({ name }) => excludedFunctions.has(name))) return [];
    return [{ name: `${object}.ts`, text: deriveEngineSource(text, excludedFunctions) }];
  } catch (error) {
    if (!(error instanceof GeneratorError)) throw error;
    problems.add(null, `builtins/${object}.js: ${error.message}`);
    return [];
  }
}

export function engineFiles(javaScriptCore: string, declared: readonly SourcedDeclaration[]): ModelEngineFile[] {
  const declarations = declared.map(({ declaration }) => declaration);
  const excludedByObject = Map.groupBy(
    declarations.flatMap(declaration => (declaration.declares === "ExcludedFunction" ? [declaration.function] : [])),
    excludedFunction => excludedFunction.file,
  );
  const handwrittenObjects = new Set(
    declarations.flatMap(declaration => (declaration.declares === "HandwrittenFile" ? [declaration.file] : [])),
  );
  const modelFiles = readCMakeList(join(javaScriptCore, tableListFile), modelListName);
  const readEngineFile = (path: string): string => readFileSync(join(javaScriptCore, path), "utf8");

  const problems = new Problems();
  const files = [
    ...engineBuiltinSources(javaScriptCore).flatMap(source => {
      const object = basename(source, ".js");
      if (handwrittenObjects.has(object)) return [];
      const excludedFunctions = new Set(excludedByObject.get(object)?.map(({ name }) => name));
      return deriveEngineFile(object, readFileSync(source, "utf8"), excludedFunctions, problems);
    }),
    ...Array.from(handwrittenObjects, object => ({
      name: `${object}.ts`,
      text: readEngineFile(`${handwrittenDirectory}/${object}.ts`),
    })),
    ...modelFiles.map(path => ({ name: `models/${basename(path)}`, text: readEngineFile(path) })),
  ];
  problems.throwIfAny();
  return files.sort((left, right) => compareBytes(left.name, right.name));
}
