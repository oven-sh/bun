const rustKeywords: ReadonlySet<string> = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "become",
  "box",
  "break",
  "const",
  "continue",
  "crate",
  "do",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "final",
  "fn",
  "for",
  "gen",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "macro",
  "match",
  "mod",
  "move",
  "mut",
  "override",
  "priv",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "try",
  "type",
  "typeof",
  "unsafe",
  "unsized",
  "use",
  "virtual",
  "where",
  "while",
  "yield",
]);

function isUpper(character: string): boolean {
  return character >= "A" && character <= "Z";
}

function isLower(character: string): boolean {
  return character >= "a" && character <= "z";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

export function upperFirst(name: string): string {
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

export function lowerFirst(name: string): string {
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

export function snakeCase(name: string): string {
  let result = "";
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index];
    const previous = index > 0 ? name[index - 1] : "";
    const next = index + 1 < name.length ? name[index + 1] : "";
    const startsWord = isLower(previous) || isDigit(previous) || (isUpper(previous) && isLower(next));
    if (isUpper(character) && startsWord) result += "_";
    result += character.toLowerCase();
  }
  return result;
}

export function screamingCase(name: string): string {
  return snakeCase(name).toUpperCase();
}

export function rustIdentifier(name: string): string {
  const snake = snakeCase(name);
  if (snake === "type") return "ty";
  return rustKeywords.has(snake) ? `${snake}_value` : snake;
}

export function rustTypeName(name: string): string {
  return name.endsWith("ID") ? `${name.slice(0, -2)}Id` : name;
}

export function rustIdTypeName(idKind: string): string {
  return `${idKind}Id`;
}

export function cppIdTypeName(idKind: string): string {
  return `${idKind}ID`;
}

export function cppColumnFunctionName(column: string): string {
  return `${column}Of`;
}

export function cppSetterName(name: string): string {
  return `set${upperFirst(name)}`;
}

export function cppOperandGetterName(operand: string, isVariadic: boolean): string {
  return `${operand}${isVariadic ? "Operands" : "Operand"}`;
}

export function cppRuntimeFunctionName(operation: string): string {
  return `operationAOT${operation}`;
}

export function cppEmitterClassName(family: string): string {
  return `${family}Emitter`;
}

export function cppGenerateFunctionName(entry: string): string {
  return `generate${entry}`;
}

export function cppFamilyMacroName(prefix: "OPCODE" | "TERMINATOR_KIND" | "INLINE_BUILTIN", family: string): string {
  return `FOR_EACH_AOT_${prefix}_IN_${screamingCase(family)}`;
}

export function programListMemberName(list: string): string {
  return upperFirst(list);
}

export const reservedAccessorNames: ReadonlySet<string> = new Set([
  "addPayloadTo",
  "appendVariadicOperand",
  "arguments",
  "become",
  "caseTargets",
  "child",
  "children",
  "done",
  "expected",
  "expectedOrType",
  "flags",
  "forEachChild",
  "forEachOperand",
  "hasCases",
  "hasPosition",
  "hasSamePayloadAs",
  "inlineFrame",
  "inlinePayload",
  "isConditionalBranch",
  "kind",
  "miss",
  "mutablePayloadListFrom",
  "mutableVariadicOperands",
  "next",
  "noPosition",
  "notTaken",
  "numberOfNamedOperands",
  "numberOfOperands",
  "numberOfVariadicOperands",
  "opcode",
  "operand",
  "operandKind",
  "operandUses",
  "origin",
  "otherwise",
  "outOfLinePayload",
  "payloadListFrom",
  "payloadListOf",
  "payloadWordAt",
  "payloadWordPairAt",
  "position",
  "removeVariadicOperand",
  "representation",
  "resetOperandsAndPayload",
  "setExpected",
  "setOperand",
  "setOrigin",
  "setPayloadListFrom",
  "setPayloadListOf",
  "setPayloadWordAt",
  "setPayloadWordPairAt",
  "setVariadicOperands",
  "taken",
  "targets",
  "type",
  "variadicOperandIndex",
  "variadicOperands",
]);
