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

/** Nothing: it is no intrinsic. The name is in a type, or the file declares it, so that it is an ordinary variable. */
function positionOf(node: ts.Identifier, declared: Set<string>): Position | undefined {
  if (isInType(node)) return undefined;
  const parent = node.parent as any;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node)
  )
    return "Member";
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
  if (
    ts.isBindingElement(parent) &&
    parent.name === node &&
    !parent.propertyName &&
    ts.isObjectBindingPattern(parent.parent)
  )
    return "Member";
  if (ts.isShorthandPropertyAssignment(parent)) return "Member";
  if (declared.has(node.text)) return undefined;
  return ts.isCallExpression(parent) && parent.expression === node ? "Call" : "Value";
}

export function censusOfText(file: string, text: string): Use[] {
  const uses: Use[] = [];
  const kind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
  const declared = new Set<string>();
  const collect = (node: ts.Node) => {
    if (isDollarName(node) && declares(node) && !isInType(node)) declared.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const visit = (node: ts.Node) => {
    if (isDollarName(node)) {
      const position = positionOf(node, declared);
      if (position)
        uses.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          name: node.text.slice(1),
          position,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

export function census(files: string[]): Use[] {
  return files.flatMap(file => censusOfText(file, fs.readFileSync(file, "utf8")));
}
