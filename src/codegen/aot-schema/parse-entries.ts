import {
  parseKind,
  parseSeparated,
  parseType,
  parseValue,
  parseWireThenEngine,
  takeName,
  takeWord,
} from "./parse-types.ts";
import { SchemaError } from "./source.ts";
import type {
  ColumnValueSyntax,
  EffectItemSyntax,
  EffectsSyntax,
  EntrySyntax,
  FamilySyntax,
  FlagSyntax,
  FormRangeSyntax,
  HeapReferenceSyntax,
  InlineEntrySyntax,
  InlineSyntax,
  Name,
  NamedEffectsSyntax,
  NamedUsesSyntax,
  ParameterGroupSyntax,
  ParameterSyntax,
  ProtocolSyntax,
  ResultSyntax,
  RuleSyntax,
  RuntimeParameterSyntax,
  RuntimeSyntax,
  TargetSyntax,
  UseSyntax,
} from "./syntax.ts";
import { Cursor, isPunctuation, type Token } from "./tokens.ts";

interface EntryTail {
  readonly effects: EffectsSyntax;
  readonly forms: FormRangeSyntax | null;
  readonly columns: readonly ColumnValueSyntax[];
}

function parseProtocol(cursor: Cursor): ProtocolSyntax {
  const name = takeWord(cursor);
  if (!cursor.accept("(")) return { name, namedMembers: [] };
  const namedMembers = parseSeparated(cursor, ")", takeWord);
  cursor.expect(")");
  return { name, namedMembers };
}

function parseProtocols(cursor: Cursor): ProtocolSyntax[] {
  cursor.expect("(");
  const protocols = [parseProtocol(cursor)];
  while (cursor.accept("+")) protocols.push(parseProtocol(cursor));
  cursor.expect(")");
  return protocols;
}

function parseUse(cursor: Cursor): UseSyntax {
  const name = takeWord(cursor);
  if (name.text === "runs") return { name, operand: null, protocols: parseProtocols(cursor) };
  const takesOperand = name.text === "retains" || name.text === "assignsFrom";
  if (!takesOperand || !cursor.accept("(")) return { name, operand: null, protocols: [] };
  const operand = takeWord(cursor);
  cursor.expect(")");
  return { name, operand, protocols: [] };
}

export function parseUses(cursor: Cursor): UseSyntax[] {
  if (!cursor.atWord()) return [];
  const uses = [parseUse(cursor)];
  while (cursor.accept("+")) uses.push(parseUse(cursor));
  return uses;
}

function atParameterGroup(cursor: Cursor): boolean {
  return cursor.at("with") && cursor.atWord(1) && !cursor.at(":", 2) && !cursor.at("?", 2) && !cursor.at("...", 2);
}

function parseParameter(cursor: Cursor, owner: string): ParameterSyntax {
  if (atParameterGroup(cursor)) {
    cursor.next();
    return { form: "Group", group: takeWord(cursor) };
  }
  const isEngine = cursor.atWord(1) && cursor.accept("engine");
  let firstForm: Name | null = null;
  if (cursor.at("from") && cursor.atWord(1) && cursor.atWord(2)) {
    cursor.next();
    firstForm = takeWord(cursor);
  }
  const name = takeName(cursor);
  const isOptional = cursor.accept("?");
  const isVariadic = !isOptional && cursor.accept("...");
  cursor.expect(":");
  const kind = parseKind(cursor);
  const isBareName = kind.role === null && kind.element === null && kind.arrayLength === null;
  if (isBareName && cursor.accept("/")) {
    if (firstForm !== null) throw new SchemaError(name.location, `operand ${name.text} of ${owner} has a first form`);
    return { form: "Operand", name, kind: kind.name, uses: parseUses(cursor), isOptional, isVariadic, isEngine };
  }
  return { form: "Payload", name, kind, isOptional, isVariadic, isEngine, firstForm };
}

export function parseParameters(cursor: Cursor, owner: string): ParameterSyntax[] {
  cursor.expect("(");
  const parameters = cursor.at(")") ? [] : parseSeparated(cursor, ")", inner => parseParameter(inner, owner));
  cursor.expect(")");
  return parameters;
}

function parseHeapReference(cursor: Cursor): HeapReferenceSyntax {
  const heap = takeWord(cursor);
  if (!cursor.accept("[")) return { heap, indexes: [] };
  const indexes = parseSeparated(cursor, "]", takeWord);
  cursor.expect("]");
  return { heap, indexes };
}

function parseHeapReferences(cursor: Cursor): HeapReferenceSyntax[] {
  cursor.expect("(");
  const heaps = parseSeparated(cursor, ")", parseHeapReference);
  cursor.expect(")");
  return heaps;
}

function parseEffectItem(cursor: Cursor, word: Name): EffectItemSyntax {
  if (word.text === "reads") return { form: "Reads", heaps: parseHeapReferences(cursor), location: word.location };
  if (word.text === "writes") return { form: "Writes", heaps: parseHeapReferences(cursor), location: word.location };
  return { form: "Word", word };
}

export function parseEffects(tokens: readonly Token[]): EffectsSyntax {
  const cursor = new Cursor(tokens);
  const location = cursor.location;
  const items: EffectItemSyntax[] = [];
  let rule: Name | null = null;
  while (rule === null && cursor.hasMore) {
    const word = takeWord(cursor);
    if (word.text === "by") rule = takeWord(cursor);
    else items.push(parseEffectItem(cursor, word));
  }
  cursor.finish();
  if (items.length === 0) throw new SchemaError(location, "expected effects");
  return { items, rule, location };
}

function parseResultList(cursor: Cursor): Pick<RuleSyntax, "indexEnum" | "results" | "isOpen"> {
  let indexEnum: Name | null = null;
  if (cursor.atWord() && cursor.at(":", 1)) {
    indexEnum = takeWord(cursor);
    cursor.next();
  }
  const results: ResultSyntax[] = [];
  for (;;) {
    if (cursor.accept("..")) return { indexEnum, results, isOpen: true };
    results.push(parseResult(cursor));
    if (!cursor.accept(",")) return { indexEnum, results, isOpen: false };
  }
}

function parseAllocation(cursor: Cursor): Pick<RuleSyntax, "argument" | "contents"> {
  const argument = takeWord(cursor);
  if (!cursor.accept("<")) return { argument, contents: null };
  const contents = takeWord(cursor);
  cursor.expect(">");
  return { argument, contents };
}

function parseRuleArguments(cursor: Cursor, bare: RuleSyntax, opener: Token): RuleSyntax {
  switch (bare.rule.text) {
    case "results":
      return { ...bare, ...parseResultList(cursor) };
    case "natural":
      return { ...bare, type: parseType(cursor) };
    case "allocation":
      return { ...bare, ...parseAllocation(cursor) };
    case "cast":
    case "declared":
      return { ...bare, argument: takeWord(cursor) };
    default:
      throw new SchemaError(opener.location, "unexpected '('");
  }
}

export function parseRule(cursor: Cursor): RuleSyntax {
  const rule = takeWord(cursor);
  const bare: RuleSyntax = {
    rule,
    argument: null,
    contents: null,
    type: null,
    indexEnum: null,
    results: [],
    isOpen: false,
  };
  if (!cursor.at("(")) return bare;
  const syntax = parseRuleArguments(cursor, bare, cursor.next());
  cursor.expect(")");
  return syntax;
}

export function parseResult(cursor: Cursor): ResultSyntax {
  const unproven = parseRule(cursor);
  return { unproven, proven: cursor.accept("=>") ? parseRule(cursor) : null };
}

function parseFlag(cursor: Cursor, isEngine: boolean): FlagSyntax {
  return { name: takeName(cursor), isEngine };
}

function parseFlags(cursor: Cursor): FlagSyntax[] {
  cursor.expect("[");
  const flags = parseWireThenEngine(cursor, "]", parseFlag);
  cursor.expect("]");
  return flags;
}

function parseTarget(cursor: Cursor): TargetSyntax {
  const name = takeName(cursor);
  const isVariadic = cursor.accept("...");
  if (!cursor.accept("(")) return { name, isVariadic, takesProofs: false, results: [] };
  const takesProofs = cursor.accept("proof");
  const results = takesProofs ? [] : parseSeparated(cursor, ")", parseResult);
  cursor.expect(")");
  return { name, isVariadic, takesProofs, results };
}

function parseTargets(cursor: Cursor): TargetSyntax[] {
  if (cursor.accept("none")) return [];
  const targets = [parseTarget(cursor)];
  while (cursor.accept(",")) targets.push(parseTarget(cursor));
  return targets;
}

export function parseColumnValue(tokens: readonly Token[]): ColumnValueSyntax {
  const cursor = new Cursor(tokens);
  const column = takeWord(cursor);
  cursor.expect("=");
  const values = [parseValue(cursor)];
  while (cursor.accept(",")) values.push(parseValue(cursor));
  cursor.finish();
  return { column, values };
}

function parseFormRange(cursor: Cursor): FormRangeSyntax {
  const first = takeWord(cursor);
  cursor.expect("..");
  return { first, last: takeWord(cursor) };
}

function takeNonEmptySegment(cursor: Cursor, description: string): Token[] {
  const tokens = cursor.takeSegment();
  if (tokens.length === 0) throw cursor.expected(description);
  return tokens;
}

function expectEffectsSegment(cursor: Cursor, owner: Name): void {
  if (cursor.hasMore) cursor.expect(";");
  const isMissing = !cursor.hasMore || cursor.at("..", 1) || cursor.at("=", 1);
  if (isMissing) throw new SchemaError(owner.location, `${owner.text} has no effects`);
}

function parseTail(cursor: Cursor): EntryTail {
  const effects = parseEffects(takeNonEmptySegment(cursor, "effects"));
  let forms: FormRangeSyntax | null = null;
  const columns: ColumnValueSyntax[] = [];
  while (cursor.accept(";")) {
    const tokens = takeNonEmptySegment(cursor, "a column or forms");
    if (tokens.length !== 3 || !isPunctuation(tokens[1], "..")) {
      columns.push(parseColumnValue(tokens));
      continue;
    }
    const segment = new Cursor(tokens);
    if (forms !== null) throw new SchemaError(segment.location, "forms are listed twice");
    forms = parseFormRange(segment);
  }
  return { effects, forms, columns };
}

export function parseEntry(cursor: Cursor, declares: "operation" | "terminator", isEngine: boolean): EntrySyntax {
  const name = takeName(cursor);
  const parameters = parseParameters(cursor, name.text);
  const flags = cursor.at("[") ? parseFlags(cursor) : [];
  if (!cursor.accept("->")) throw new SchemaError(name.location, `${name.text} has no result rule`);
  const result = declares === "operation" ? parseResult(cursor) : null;
  const targets = declares === "terminator" ? parseTargets(cursor) : [];
  expectEffectsSegment(cursor, name);
  return { declares, name, isEngine, parameters, flags, result, targets, ...parseTail(cursor) };
}

export function parseFamily(cursor: Cursor): FamilySyntax {
  const name = takeName(cursor);
  const forms = parseFormRange(cursor);
  const defaults: ColumnValueSyntax[] = [];
  while (cursor.accept(";")) defaults.push(parseColumnValue(takeNonEmptySegment(cursor, "a column")));
  return { declares: "family", name, forms, defaults };
}

export function parseNamedEffects(cursor: Cursor): NamedEffectsSyntax {
  const name = takeName(cursor);
  cursor.expect("=");
  return { declares: "effects", name, effects: parseEffects(takeNonEmptySegment(cursor, "effects")) };
}

export function parseNamedUses(cursor: Cursor): NamedUsesSyntax {
  const name = takeName(cursor);
  cursor.expect("=");
  const uses = parseUses(cursor);
  if (uses.length === 0) throw cursor.expected("a use");
  return { declares: "uses", name, uses };
}

export function parseParameterGroup(cursor: Cursor): ParameterGroupSyntax {
  const name = takeName(cursor);
  return { declares: "parameters", name, parameters: parseParameters(cursor, name.text) };
}

function parseCType(cursor: Cursor): string {
  let type = cursor.word().text;
  if (type === "const") type += ` ${cursor.word().text}`;
  while (cursor.accept("*")) type += "*";
  return type;
}

function parseRuntimeParameter(cursor: Cursor): RuntimeParameterSyntax {
  const location = cursor.location;
  const type = parseCType(cursor);
  return { type, name: cursor.atWord() ? takeWord(cursor) : null, location };
}

export function parseRuntime(cursor: Cursor): RuntimeSyntax {
  const first = takeName(cursor);
  const names = [first];
  while (cursor.accept(",")) names.push(takeName(cursor));
  cursor.expect(":");
  const resultType = parseCType(cursor);
  cursor.expect("(");
  const parameters = cursor.at(")") ? [] : parseSeparated(cursor, ")", parseRuntimeParameter);
  cursor.expect(")");
  expectEffectsSegment(cursor, first);
  const effects = parseEffects(takeNonEmptySegment(cursor, "effects"));
  const isLeaf = cursor.accept(";");
  if (isLeaf) cursor.expect("leaf");
  const preservesMost = isLeaf && cursor.accept("preserveMost");
  return { declares: "runtime", names, resultType, parameters, effects, isLeaf, preservesMost };
}

function parseInlineEntry(cursor: Cursor): InlineEntrySyntax {
  const name = takeName(cursor);
  if (!cursor.accept("(")) return { name, parameterKinds: [] };
  const parameterKinds = parseSeparated(cursor, ")", takeWord);
  cursor.expect(")");
  return { name, parameterKinds };
}

export function parseInline(cursor: Cursor): InlineSyntax {
  const first = parseInlineEntry(cursor);
  const entries = [first];
  while (cursor.hasMore && !cursor.at(";")) entries.push(parseInlineEntry(cursor));
  expectEffectsSegment(cursor, first.name);
  const effects = parseEffects(takeNonEmptySegment(cursor, "effects"));
  cursor.accept(";");
  cursor.expect("family");
  const family = takeName(cursor);
  let hasOptionalSlowPath = false;
  let isFormOnly = false;
  while (cursor.accept(";")) {
    const mark = cursor.location;
    if (cursor.accept("formOnly")) {
      if (isFormOnly) throw new SchemaError(mark, "formOnly is listed twice");
      isFormOnly = true;
      continue;
    }
    cursor.expect("optionalSlowPath");
    if (hasOptionalSlowPath) throw new SchemaError(mark, "optionalSlowPath is listed twice");
    hasOptionalSlowPath = true;
  }
  return { declares: "inline", entries, effects, family, hasOptionalSlowPath, isFormOnly };
}
