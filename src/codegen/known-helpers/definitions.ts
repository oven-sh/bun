import { canonicalFunction, forEachPatternName, isFunction, parseProgram, textOf, type Node } from "./syntax.ts";

export type FoundReference =
  | { readonly name: string; readonly kind: "itself" }
  | { readonly name: string; readonly kind: "global"; readonly path: readonly string[] }
  | { readonly name: string; readonly kind: "definition"; readonly publishedName: string; readonly trees: readonly string[] }
  | { readonly name: string; readonly kind: "operand" }
  | { readonly name: string; readonly kind: "unknown"; readonly why: string };

export interface FoundFunction {
  readonly publishedName: string;
  readonly part: number;
  readonly partCount: number;
  readonly where: string;
  readonly text: string;
  readonly tree: string;
  readonly unsupported?: string;
  readonly references: readonly FoundReference[];
}

export interface ImportedValue {
  readonly source: string;
  readonly name: string;
}

export interface MemberValue {
  readonly object: Node;
  readonly name: string;
}

export interface Definition {
  readonly name: string;
  readonly unit: Unit;
  readonly values: Node[];
  imported?: ImportedValue;
  member?: MemberValue;
}

export interface Unit {
  readonly where: string;
  readonly text: string;
  readonly definitions: Map<string, Definition>;
  readonly exports: Map<string, string>;
  readonly statements: Node[];
  resolveImport?: (imported: ImportedValue) => Definition | undefined;
}

export function exportOf(unit: Unit, name: string): Definition | undefined {
  const local = unit.exports.get(name) ?? (name === "default" ? unit.exports.get("*") : undefined);
  return local === undefined ? undefined : unit.definitions.get(local);
}

export function hashOfTree(tree: string): string {
  return new Bun.CryptoHasher("sha256").update(tree).digest("hex").slice(0, 24);
}

function withoutParentheses(node: Node): Node {
  return node.type === "ParenthesizedExpression" ? withoutParentheses(node.expression) : node;
}

export function functionsIn(value: Node): Node[] {
  const node = withoutParentheses(value);
  if (isFunction(node)) return [node];
  switch (node.type) {
    case "LogicalExpression":
      return [...functionsIn(node.left), ...functionsIn(node.right)];
    case "ConditionalExpression":
      return [...functionsIn(node.consequent), ...functionsIn(node.alternate)];
    case "AssignmentExpression":
      return functionsIn(node.right);
    case "CallExpression": {
      const callee = withoutParentheses(node.callee);
      return isFunction(callee) ? [callee, ...node.arguments.flatMap(functionsIn)] : [];
    }
    default:
      return [];
  }
}

function requiredValue(value: Node): ImportedValue | undefined {
  const node = withoutParentheses(value);
  if (node.type === "MemberExpression") {
    const from = requiredValue(node.object);
    if (from === undefined || from.name !== "*") return undefined;
    if (!node.computed && node.property.type === "Identifier") return { source: from.source, name: node.property.name };
    if (node.computed && node.property.type === "StringLiteral") return { source: from.source, name: node.property.value };
    return undefined;
  }
  if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "require") return undefined;
  const [source] = node.arguments;
  return node.arguments.length === 1 && source.type === "StringLiteral" ? { source: source.value, name: "*" } : undefined;
}

function define(unit: Unit, name: string): Definition {
  let definition = unit.definitions.get(name);
  if (definition === undefined) {
    definition = { name, unit, values: [] };
    unit.definitions.set(name, definition);
  }
  return definition;
}

function nameOfKey(property: Node): string | undefined {
  if (property.key.type === "StringLiteral") return property.key.value;
  return !property.computed && property.key.type === "Identifier" ? property.key.name : undefined;
}

function collectDestructuring(unit: Unit, pattern: Node, value: Node | null | undefined): void {
  forEachPatternName(pattern, name => void define(unit, name));
  if (pattern.type !== "ObjectPattern" || !value) return;
  const required = requiredValue(value);
  for (const property of pattern.properties) {
    if (property.type !== "ObjectProperty" || property.value.type !== "Identifier") continue;
    const name = nameOfKey(property);
    if (name === undefined) continue;
    const definition = define(unit, property.value.name);
    if (required === undefined) definition.member = { object: value, name };
    else if (required.name === "*") definition.imported = { source: required.source, name };
  }
}

function exportedName(target: Node): string | undefined {
  if (target.type !== "MemberExpression") return undefined;
  const isModuleExports = (node: Node) =>
    node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.object.name === "module" && node.property.name === "exports";
  if (isModuleExports(target)) return "*";
  const isExports = (target.object.type === "Identifier" && target.object.name === "exports") || isModuleExports(target.object);
  if (!isExports) return undefined;
  if (!target.computed && target.property.type === "Identifier") return target.property.name;
  return target.computed && target.property.type === "StringLiteral" ? target.property.value : undefined;
}

function collectAssignments(unit: Unit, expression: Node): void {
  const node = withoutParentheses(expression);
  if (node.type === "SequenceExpression") {
    for (const part of node.expressions) collectAssignments(unit, part);
    return;
  }
  if (node.type !== "AssignmentExpression" || node.operator !== "=") return;
  let value: Node = node;
  const exported: string[] = [];
  while (value.type === "AssignmentExpression" && value.operator === "=" && exportedName(value.left) !== undefined) {
    exported.push(exportedName(value.left)!);
    value = withoutParentheses(value.right);
  }
  if (exported.length > 0) {
    if (value.type === "Identifier") for (const name of exported) unit.exports.set(name, value.name);
    return;
  }
  if (node.left.type === "Identifier") define(unit, node.left.name).values.push(node.right);
}

export function collectDefinitions(unit: Unit, statements: readonly Node[]): void {
  for (const statement of statements) {
    switch (statement.type) {
      case "VariableDeclaration":
        for (const declarator of statement.declarations) {
          if (declarator.id.type !== "Identifier") {
            collectDestructuring(unit, declarator.id, declarator.init);
            continue;
          }
          const definition = define(unit, declarator.id.name);
          if (!declarator.init) continue;
          const imported = requiredValue(declarator.init);
          if (imported) definition.imported = imported;
          else definition.values.push(declarator.init);
        }
        break;
      case "FunctionDeclaration":
        if (statement.id) define(unit, statement.id.name).values.push(statement);
        break;
      case "ExpressionStatement":
        collectAssignments(unit, statement.expression);
        break;
      case "ExportNamedDeclaration":
        if (statement.declaration) {
          collectDefinitions(unit, [statement.declaration]);
          const declared: Node[] = statement.declaration.declarations?.map((declarator: Node) => declarator.id) ?? [statement.declaration.id];
          for (const id of declared) if (id?.type === "Identifier") unit.exports.set(id.name, id.name);
        } else if (!statement.source) {
          for (const specifier of statement.specifiers) unit.exports.set(specifier.exported.name ?? specifier.exported.value, specifier.local.name);
        }
        break;
      case "ExportDefaultDeclaration":
        if (statement.declaration.type === "FunctionDeclaration") {
          const name = statement.declaration.id?.name ?? "default";
          define(unit, name).values.push(statement.declaration);
          unit.exports.set("default", name);
        } else if (statement.declaration.type === "Identifier") unit.exports.set("default", statement.declaration.name);
        break;
      case "ImportDeclaration":
        for (const specifier of statement.specifiers) {
          const name =
            specifier.type === "ImportDefaultSpecifier"
              ? "default"
              : specifier.type === "ImportNamespaceSpecifier"
                ? "*"
                : (specifier.imported.name ?? specifier.imported.value);
          define(unit, specifier.local.name).imported = { source: statement.source.value, name };
        }
        break;
    }
  }
}

export function readUnit(where: string, text: string, scopes?: (program: Node) => readonly (readonly Node[])[]): Unit | undefined {
  const program = parseProgram(text);
  if (program === undefined) return undefined;
  const unit: Unit = { where, text, definitions: new Map(), exports: new Map(), statements: [] };
  for (const statements of scopes?.(program) ?? [program.body]) {
    unit.statements.push(...statements);
    collectDefinitions(unit, statements);
  }
  return unit;
}

function globalPath(unit: Unit, value: Node): string[] | undefined {
  const node = withoutParentheses(value);
  if (node.type === "Identifier") return unit.definitions.has(node.name) ? undefined : [node.name];
  if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier") return undefined;
  const object = globalPath(unit, node.object);
  return object && [...object, node.property.name];
}

function globalPathOf(definition: Definition): string[] | undefined {
  if (definition.member === undefined) return definition.values.length === 1 ? globalPath(definition.unit, definition.values[0]) : undefined;
  const object = definition.values.length === 0 ? globalPath(definition.unit, definition.member.object) : undefined;
  return object && [...object, definition.member.name];
}

function treesOf(definition: Definition): string[] {
  const isOuterName = (name: string) => definition.unit.definitions.has(name);
  return definition.values.flatMap(functionsIn).map(node => hashOfTree(canonicalFunction(node, isOuterName).tree));
}

function followImports(definition: Definition): Definition | undefined {
  let current: Definition | undefined = definition;
  for (let hops = 0; current?.imported !== undefined && hops < 4; hops++) {
    current = current.unit.resolveImport?.(current.imported);
  }
  return current;
}

function describeOtherValue(definition: Definition): string {
  if (definition.member !== undefined) return `it is the member ${definition.member.name} of something that is no global, or it is assigned again`;
  if (definition.values.length === 0) return "it is declared without a value: functions keep something in it";
  const written = definition.values.map(value => definition.unit.text.slice(value.start, value.end)).join(" | ");
  return `its value is neither a function nor a global: ${written.slice(0, 120)}`;
}

function referenceTo(name: string, from: Definition): FoundReference {
  const named = from.unit.definitions.get(name)!;
  if (named === from) return { name, kind: "itself" };
  const definition = followImports(named);
  if (definition === undefined) return { name, kind: "unknown", why: `imported from ${named.imported?.source}, which was not read` };
  const trees = treesOf(definition);
  if (trees.length > 0) return { name, kind: "definition", publishedName: definition.name, trees };
  const path = globalPathOf(definition);
  return path ? { name, kind: "global", path } : { name, kind: "unknown", why: describeOtherValue(definition) };
}

export function functionsOf(definition: Definition): FoundFunction[] {
  const unit = definition.unit;
  const isOuterName = (name: string) => unit.definitions.has(name);
  const functions = definition.values.flatMap(functionsIn);
  return functions.map((node, index) => {
    const canonical = canonicalFunction(node, isOuterName);
    return {
      publishedName: definition.name,
      part: index + 1,
      partCount: functions.length,
      where: unit.where,
      text: textOf(unit.text, node),
      tree: hashOfTree(canonical.tree),
      unsupported: canonical.unsupported,
      references: canonical.outerNames.map(name => referenceTo(name, definition)),
    };
  });
}

export const reExportLoopName = "Object.keys(..).forEach";

function reExportLoopCallback(statement: Node): Node | undefined {
  if (statement.type !== "ExpressionStatement" || statement.expression.type !== "CallExpression") return undefined;
  const { callee, arguments: [callback] } = statement.expression;
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "forEach") return undefined;
  const keys = callee.object;
  if (keys.type !== "CallExpression" || keys.callee.type !== "MemberExpression" || keys.callee.property.name !== "keys") return undefined;
  return callback && isFunction(callback) ? callback : undefined;
}

export function callbacksOfUnit(unit: Unit, isOperandName: (name: string) => boolean): FoundFunction[] {
  const found: FoundFunction[] = [];
  for (const statement of unit.statements) {
    const callback = reExportLoopCallback(statement);
    if (callback === undefined) continue;
    const [one] = functionsOf({ name: reExportLoopName, unit, values: [callback] });
    const references = one.references.map(reference =>
      isOperandName(reference.name) || reference.kind === "unknown" ? ({ name: reference.name, kind: "operand" } as const) : reference,
    );
    found.push({ ...one, references });
  }
  return found;
}

export function functionsOfUnit(unit: Unit, isHelperName: (name: string) => boolean): FoundFunction[] {
  return [...unit.definitions.values()].filter(definition => isHelperName(definition.name)).flatMap(functionsOf);
}

export function withoutRepeats(found: readonly FoundFunction[]): FoundFunction[] {
  const seen = new Set<string>();
  return found.filter(one => {
    const key = `${one.publishedName} ${one.part} ${one.tree} ${JSON.stringify(one.references)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
