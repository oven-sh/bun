// Every use of a `$name` in files of src/js, by where it stands: what `resolve_intrinsic` (src/aot/build/intrinsics.rs) is asked for it.
// builtins-manifest.ts holds the uses against src/aot/build/intrinsics.txt.
import fs from "node:fs";
import ts from "typescript";

export type Position = "Call" | "Value" | "Member";
export interface Use {
  file: string;
  line: number;
  /** Without the `$`. */
  name: string;
  position: Position;
}

function isDollarName(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text.startsWith("$") && node.text.length > 1;
}

function isInType(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeNode(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) return true;
    if (ts.isHeritageClause(parent) && parent.token === ts.SyntaxKind.ImplementsKeyword) return true;
    if (ts.canHaveModifiers(parent)) {
      if (ts.getModifiers(parent)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true;
    } else if (ts.isStatement(parent) && !ts.isBlock(parent)) return false;
  }
  return false;
}

function declares(node: ts.Identifier): boolean {
  const parent = node.parent as ts.NamedDeclaration;
  if (parent.name !== node) return false;
  return (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isBindingElement(parent)
  );
}

/** Nothing: `resolve_intrinsic` is not asked. The name is in a type, or the file declares it, so that it is an ordinary variable. */
function positionOf(node: ts.Identifier, declared: Set<string>): Position | undefined {
  if (isInType(node)) return undefined;
  const parent = node.parent as any;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node)) return "Member";
  const isKey =
    parent.name === node &&
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessor(parent) ||
      ts.isSetAccessor(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent));
  if (isKey || (ts.isBindingElement(parent) && parent.propertyName === node)) return "Member";
  // `{ $name }`: in a pattern the key, and a variable of the file; in a literal the key, and the value unless the file declares it.
  if (ts.isBindingElement(parent) && parent.name === node && !parent.propertyName && ts.isObjectBindingPattern(parent.parent)) return "Member";
  if (ts.isShorthandPropertyAssignment(parent)) return "Member";
  if (declared.has(node.text)) return undefined;
  return ts.isCallExpression(parent) && parent.expression === node ? "Call" : "Value";
}

/**
 * `Checker::uncurried_builtin_held_by` (src/sema/check/aot/builtin_constants.rs) takes `uncurryThis(f)(receiver, ..args)` for a call of `f` on
 * `receiver`. That is so as long as internal/primordials.js says what it says here. Nothing: it does. Else what is no longer there.
 */
export function uncurryThisMismatch(primordials: string): string | undefined {
  const source = ts.createSourceFile(primordials, fs.readFileSync(primordials, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const printer = ts.createPrinter({ removeComments: true });
  const statements = source.statements.map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, source).replace(/\s+/g, " "));
  for (const expected of [
    'const FunctionPrototypeCall = $getByIdDirect(Function.prototype, "call");',
    "function uncurryThis(func) { return FunctionPrototypeCall.bind(func); }",
  ]) {
    if (statements.filter(statement => statement === expected).length !== 1) return expected;
  }
  const exported = source.statements.find(ts.isExportAssignment)?.expression;
  const isExported =
    exported !== undefined &&
    ts.isObjectLiteralExpression(exported) &&
    exported.properties.some(property => ts.isShorthandPropertyAssignment(property) && property.name.text === "uncurryThis");
  return isExported ? undefined : "export default { uncurryThis }";
}

export function census(files: string[]): Use[] {
  const uses: Use[] = [];
  for (const file of files) {
    const kind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, kind);
    const declared = new Set<string>();
    const collect = (node: ts.Node) => {
      if (isDollarName(node) && declares(node) && !isInType(node)) declared.add(node.text);
      ts.forEachChild(node, collect);
    };
    collect(source);
    const visit = (node: ts.Node) => {
      if (isDollarName(node)) {
        const position = positionOf(node, declared);
        if (position) uses.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, name: node.text.slice(1), position });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
}
