import { SchemaError } from "./source.ts";
import type {
  CaseSyntax,
  ColumnDeclarationSyntax,
  EnumSyntax,
  ExternalSyntax,
  FieldSyntax,
  KindSyntax,
  ListSyntax,
  MemberSyntax,
  Name,
  NaturalRowSyntax,
  NaturalSyntax,
  RecordSyntax,
  TypeSyntax,
  TypeWordSyntax,
  ValueSyntax,
  VariantSyntax,
} from "./syntax.ts";
import type { Cursor } from "./tokens.ts";

const reservedWords: ReadonlySet<string> = new Set(["engine", "from", "result", "with"]);

export function takeWord(cursor: Cursor): Name {
  const { text, location } = cursor.word();
  return { text, location };
}

export function takeName(cursor: Cursor): Name {
  const name = takeWord(cursor);
  if (reservedWords.has(name.text)) throw new SchemaError(name.location, `${name.text} is a reserved word`);
  return name;
}

export function parseSeparated<Item>(cursor: Cursor, closer: string, parseItem: (cursor: Cursor) => Item): Item[] {
  const items = [parseItem(cursor)];
  while (!cursor.at(closer)) {
    cursor.expect(",");
    items.push(parseItem(cursor));
  }
  return items;
}

export function parseWireThenEngine<Item>(
  cursor: Cursor,
  closer: string,
  parseItem: (cursor: Cursor, isEngine: boolean) => Item,
): Item[] {
  const items: Item[] = [];
  let isEngine = false;
  while (!cursor.at(closer)) {
    if (!cursor.at("|")) {
      items.push(parseItem(cursor, isEngine));
      continue;
    }
    if (isEngine) throw new SchemaError(cursor.location, "unexpected '|'");
    cursor.next();
    cursor.expect("engine");
    isEngine = true;
  }
  return items;
}

export function parseKind(cursor: Cursor): KindSyntax {
  const name = takeWord(cursor);
  let role: Name | null = null;
  if (cursor.accept("(")) {
    role = takeWord(cursor);
    cursor.expect(")");
  }
  let element: KindSyntax | null = null;
  if (cursor.accept("<")) {
    element = parseKind(cursor);
    cursor.expect(">");
  }
  let arrayLength: bigint | "lists" | null = null;
  if (cursor.accept("[")) {
    arrayLength = cursor.accept("lists") ? "lists" : cursor.integer();
    cursor.expect("]");
  }
  return { name, role, element, arrayLength };
}

function parseSorted(cursor: Cursor): { isSorted: boolean; sortedBy: Name | null } {
  const isSorted = cursor.accept("sorted");
  return { isSorted, sortedBy: isSorted && cursor.accept("by") ? takeWord(cursor) : null };
}

function parseField(cursor: Cursor, isEngine: boolean): FieldSyntax {
  const name = takeWord(cursor);
  cursor.expect(":");
  const kind = parseKind(cursor);
  const isOptional = cursor.accept("?");
  const { isSorted, sortedBy } = parseSorted(cursor);
  return { name, kind, isOptional, isEngine, isSorted, sortedBy };
}

export function parseFields(cursor: Cursor, closer: string): FieldSyntax[] {
  return parseWireThenEngine(cursor, closer, parseField);
}

export function parseValue(cursor: Cursor): ValueSyntax {
  const location = cursor.location;
  switch (cursor.peek()?.kind) {
    case "text":
      return { form: "Text", value: cursor.text(), location };
    case "integer":
      return { form: "Integer", value: cursor.integer(), location };
    case "word":
      break;
    default:
      throw cursor.expected("a value");
  }
  const first = takeWord(cursor);
  const names = [first];
  while (cursor.accept("+")) names.push(takeWord(cursor));
  const isBool = names.length === 1 && (first.text === "true" || first.text === "false");
  return isBool ? { form: "Bool", value: first.text === "true", location } : { form: "Names", names, location };
}

export function parseValues(cursor: Cursor, closer: string): ValueSyntax[] {
  return parseSeparated(cursor, closer, parseValue);
}

function parseColumnDeclaration(cursor: Cursor): ColumnDeclarationSyntax {
  const name = takeName(cursor);
  cursor.expect(":");
  return { name, kind: takeWord(cursor) };
}

function parseMember(cursor: Cursor, isEngine: boolean): MemberSyntax {
  const name = takeName(cursor);
  if (!cursor.accept("(")) return { name, isEngine, values: [] };
  const values = parseValues(cursor, ")");
  cursor.expect(")");
  return { name, isEngine, values };
}

function parseMembers(cursor: Cursor): MemberSyntax[] {
  return parseWireThenEngine(cursor, "}", parseMember);
}

export function parseEnum(cursor: Cursor, declares: "enum" | "flags"): EnumSyntax {
  const name = takeName(cursor);
  const isAbi = cursor.accept("abi");
  let columns: ColumnDeclarationSyntax[] = [];
  if (cursor.at("(")) {
    if (declares === "flags") throw new SchemaError(cursor.location, "a flag word has no columns");
    cursor.next();
    columns = parseSeparated(cursor, ")", parseColumnDeclaration);
    cursor.expect(")");
  }
  cursor.expect("{");
  const members = parseMembers(cursor);
  cursor.expect("}");
  return { declares, name, isAbi, columns, members };
}

export function parseRecord(cursor: Cursor): RecordSyntax {
  const name = takeName(cursor);
  const form = takeWord(cursor);
  const marks: Name[] = [];
  while (!cursor.accept("{")) marks.push(takeWord(cursor));
  const fields = parseFields(cursor, "}");
  cursor.expect("}");
  return { declares: "record", name, form, marks, fields };
}

function parseCase(cursor: Cursor): CaseSyntax {
  const name = takeName(cursor);
  if (!cursor.accept("{")) return { name, fields: [] };
  const fields = parseFields(cursor, "}");
  cursor.expect("}");
  return { name, fields };
}

export function parseVariant(cursor: Cursor): VariantSyntax {
  const name = takeName(cursor);
  const form = takeWord(cursor);
  cursor.expect("{");
  const cases: CaseSyntax[] = [];
  while (!cursor.accept("}")) cases.push(parseCase(cursor));
  return { declares: "variant", name, form, cases };
}

export function parseList(cursor: Cursor): ListSyntax {
  const name = takeName(cursor);
  cursor.expect(":");
  const element = parseKind(cursor);
  const keyword = cursor.accept("as") ? takeWord(cursor) : null;
  const prefix = keyword !== null && cursor.accept("prefix") ? takeWord(cursor) : null;
  const { isSorted, sortedBy } = parseSorted(cursor);
  return { declares: "list", name, element, keyword, prefix, isSorted, sortedBy };
}

export function parseExternal(cursor: Cursor): ExternalSyntax {
  const name = takeName(cursor);
  cursor.expect(":");
  const form = takeWord(cursor);
  const isEngine = cursor.accept(",");
  if (isEngine) cursor.expect("engine");
  cursor.expect("=");
  const cppType = cursor.word().text;
  const rustPath = cursor.accept(",") ? cursor.word().text : null;
  const members: Name[] = [];
  if (cursor.accept("{")) {
    while (!cursor.accept("}")) members.push(takeWord(cursor));
  }
  let below: string | null = null;
  let isNamedInText = false;
  while (cursor.accept(";")) {
    const mark = cursor.location;
    if (cursor.accept("namedInText")) {
      if (isNamedInText) throw new SchemaError(mark, "namedInText is listed twice");
      isNamedInText = true;
      continue;
    }
    cursor.expect("below");
    if (below !== null) throw new SchemaError(mark, "below is listed twice");
    below = cursor.text();
  }
  return { declares: "external", name, form, isEngine, cppType, rustPath, members, below, isNamedInText };
}

function parseTypeWord(cursor: Cursor): TypeWordSyntax {
  const word = takeWord(cursor);
  if (word.text === "int" && cursor.accept("[")) {
    const minimum = cursor.integer();
    cursor.expect(",");
    const maximum = cursor.integer();
    cursor.expect("]");
    return { word, range: [minimum, maximum], sameAs: null };
  }
  if (word.text === "same" && cursor.accept("(")) {
    const sameAs = takeWord(cursor);
    cursor.expect(")");
    return { word, range: null, sameAs };
  }
  return { word, range: null, sameAs: null };
}

export function parseType(cursor: Cursor): TypeSyntax {
  const location = cursor.location;
  const words = [parseTypeWord(cursor)];
  while (cursor.accept("|")) words.push(parseTypeWord(cursor));
  return { words, location };
}

function parseNaturalRow(cursor: Cursor): NaturalRowSyntax {
  cursor.expect("(");
  const classes = parseSeparated(cursor, ")", takeWord);
  cursor.expect(")");
  cursor.expect("=>");
  return { classes, type: parseType(cursor) };
}

export function parseNatural(cursor: Cursor): NaturalSyntax {
  const name = takeName(cursor);
  const rows = [parseNaturalRow(cursor)];
  let otherwise: TypeSyntax | null = null;
  while (otherwise === null && cursor.accept(";")) {
    if (cursor.accept("else")) otherwise = parseType(cursor);
    else rows.push(parseNaturalRow(cursor));
  }
  return { declares: "natural", name, rows, otherwise };
}
