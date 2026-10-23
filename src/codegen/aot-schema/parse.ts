import {
  parseEntry,
  parseFamily,
  parseInline,
  parseNamedEffects,
  parseNamedUses,
  parseParameterGroup,
  parseRuntime,
} from "./parse-entries.ts";
import {
  parseEnum,
  parseExternal,
  parseList,
  parseNatural,
  parseRecord,
  parseVariant,
  takeName,
  takeWord,
} from "./parse-types.ts";
import { SchemaError, type Location, type ReadFile } from "./source.ts";
import type {
  ColumnSyntax,
  ConstantSyntax,
  Declaration,
  ExtendSyntax,
  HeapSyntax,
  IncludeSyntax,
  Name,
  OpaqueSyntax,
  ParsedFile,
} from "./syntax.ts";
import { Cursor, tokenize, type Token } from "./tokens.ts";

export interface DeclarationInFile {
  readonly declaration: Declaration;
  readonly file: ParsedFile;
}

const opaqueMarks: ReadonlySet<string> = new Set(["engine", "directCallsOnly", "functionLocal", "interior"]);

function parseInclude(cursor: Cursor, location: Location): IncludeSyntax {
  const path = cursor.text();
  return { declares: "include", path, isAbi: cursor.accept("abi"), location };
}

function parseConstant(cursor: Cursor): ConstantSyntax {
  const name = takeName(cursor);
  cursor.expect("=");
  return { declares: "constant", name, value: cursor.integer() };
}

function parseHeap(cursor: Cursor): HeapSyntax {
  const name = takeName(cursor);
  const indexKinds: Name[] = [];
  if (cursor.accept("[")) {
    do {
      indexKinds.push(takeWord(cursor));
    } while (cursor.accept(","));
    cursor.expect("]");
  }
  const marks: Name[] = [];
  while (cursor.hasMore) marks.push(takeWord(cursor));
  return { declares: "heap", name, indexKinds, marks };
}

function atOpaqueMark(cursor: Cursor): boolean {
  const token = cursor.peek();
  return token !== undefined && token.kind === "word" && opaqueMarks.has(token.text);
}

function parseOpaqueMarks(cursor: Cursor): Name[] {
  const marks: Name[] = [];
  while (cursor.hasMore) {
    if (!atOpaqueMark(cursor)) throw cursor.expected("engine, directCallsOnly, functionLocal or interior");
    const mark = takeWord(cursor);
    if (marks.some(earlier => earlier.text === mark.text))
      throw new SchemaError(mark.location, `${mark.text} is listed twice`);
    marks.push(mark);
  }
  return marks;
}

function parseOpaque(cursor: Cursor): OpaqueSyntax {
  const names: Name[] = [];
  while (cursor.hasMore && !atOpaqueMark(cursor)) names.push(takeName(cursor));
  if (names.length === 0) throw cursor.expected("a name");
  return { declares: "opaque", names, marks: parseOpaqueMarks(cursor) };
}

function parseColumn(cursor: Cursor): ColumnSyntax {
  const name = takeName(cursor);
  cursor.expect(":");
  return { declares: "column", name, kind: takeWord(cursor) };
}

function parseExtend(cursor: Cursor): ExtendSyntax {
  const target = takeWord(cursor);
  cursor.expect("with");
  const source = takeWord(cursor);
  cursor.expect("suffix");
  const suffix = takeWord(cursor);
  cursor.expect("as");
  return { declares: "extend", target, source, suffix, column: takeName(cursor) };
}

function parseAfterKeyword(cursor: Cursor, keyword: Token, isEngine: boolean): Declaration | null {
  switch (keyword.text) {
    case "include":
      return parseInclude(cursor, keyword.location);
    case "constant":
      return parseConstant(cursor);
    case "heap":
      return parseHeap(cursor);
    case "opaque":
      return parseOpaque(cursor);
    case "column":
      return parseColumn(cursor);
    case "extend":
      return parseExtend(cursor);
    case "enum":
      return parseEnum(cursor, "enum");
    case "flags":
      return parseEnum(cursor, "flags");
    case "record":
      return parseRecord(cursor);
    case "variant":
      return parseVariant(cursor);
    case "list":
      return parseList(cursor);
    case "external":
      return parseExternal(cursor);
    case "natural":
      return parseNatural(cursor);
    case "effects":
      return parseNamedEffects(cursor);
    case "uses":
      return parseNamedUses(cursor);
    case "parameters":
      return parseParameterGroup(cursor);
    case "family":
      return parseFamily(cursor);
    case "operation":
      return parseEntry(cursor, "operation", isEngine);
    case "terminator":
      return parseEntry(cursor, "terminator", isEngine);
    case "runtime":
      return parseRuntime(cursor);
    case "inline":
      return parseInline(cursor);
    default:
      return null;
  }
}

function declaresEntry(keyword: Token): boolean {
  return keyword.kind === "word" && (keyword.text === "operation" || keyword.text === "terminator");
}

export function parseDeclaration(tokens: readonly Token[]): Declaration {
  const cursor = new Cursor(tokens);
  const isEngine = cursor.accept("engine");
  const keyword = cursor.next();
  if (isEngine && !declaresEntry(keyword)) {
    throw new SchemaError(keyword.location, "only an operation or a terminator can be marked engine");
  }
  const declaration = keyword.kind === "word" ? parseAfterKeyword(cursor, keyword, isEngine) : null;
  if (declaration === null) throw new SchemaError(keyword.location, `unknown declaration ${keyword.text}`);
  cursor.finish();
  return declaration;
}

export function parseSchema(rootPath: string, readFile: ReadFile): ParsedFile[] {
  const files: ParsedFile[] = [];
  const openedPaths = new Set<string>();
  const read = (path: string, isAbi: boolean, from: Location | null): void => {
    const location = from ?? { path, line: 1, column: 1 };
    if (openedPaths.has(path)) throw new SchemaError(location, `${path} is included twice`);
    const text = readFile(path);
    if (text === null) throw new SchemaError(location, `cannot read ${path}`);
    openedPaths.add(path);
    const declarations: Declaration[] = [];
    files.push({ path, isAbi, declarations });
    for (const tokens of tokenize(path, text)) {
      const declaration = parseDeclaration(tokens);
      declarations.push(declaration);
      if (declaration.declares === "include") read(declaration.path, declaration.isAbi, declaration.location);
    }
  };
  read(rootPath, false, null);
  return files;
}

export function declarationsInOrder(files: readonly ParsedFile[]): DeclarationInFile[] {
  const filesByPath = new Map(files.map(file => [file.path, file]));
  const ordered: DeclarationInFile[] = [];
  const visit = (file: ParsedFile): void => {
    for (const declaration of file.declarations) {
      if (declaration.declares !== "include") {
        ordered.push({ declaration, file });
        continue;
      }
      const included = filesByPath.get(declaration.path);
      if (included === undefined) throw new SchemaError(declaration.location, `cannot read ${declaration.path}`);
      visit(included);
    }
  };
  if (files.length > 0) visit(files[0]);
  return ordered;
}
