// The scenes of a generated program share its helpers and classes, and what is known of a shared function or class is
// known from all its users together: the values of one scene widen what the code of every other scene may assume. Here
// each statement at the top of the file that names such a declaration gets a copy of its own, under a name of its own.
// The program may print something else than before; it is compared with the same text run plainly.
import ts from "typescript";
import { Random } from "./random";

const isBroken = (source: ts.SourceFile) =>
  (source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0;

type Copied = (ts.FunctionDeclaration | ts.ClassDeclaration) & { name: ts.Identifier };
type Edit = { start: number; end: number; text: string };

const hasName = (node: ts.Node, name: ts.Identifier) => (node as { name?: ts.Node }).name === name;

function isDeclared(name: ts.Identifier): boolean {
  const parent = name.parent;
  return (
    hasName(parent, name) &&
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent))
  );
}

function isMemberOrLabel(name: ts.Identifier): boolean {
  const parent = name.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === name;
  if (ts.isQualifiedName(parent)) return parent.right === name;
  if (ts.isBindingElement(parent)) return parent.propertyName === name;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  return (
    hasName(parent, name) &&
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isEnumMember(parent) ||
      ts.isNamedTupleMember(parent))
  );
}

/** Where `within` names the declaration, or undefined if it declares something of that name itself. */
function findUses(within: ts.Node, name: string, own?: ts.Identifier): ts.Identifier[] | undefined {
  const found: ts.Identifier[] = [];
  let isShadowed = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && !isMemberOrLabel(node)) {
      if (node !== own && isDeclared(node)) isShadowed = true;
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(within);
  return isShadowed ? undefined : found;
}

const renamed = (use: ts.Identifier, source: ts.SourceFile, name: string): Edit => ({
  start: use.getStart(source),
  end: use.end,
  text: ts.isShorthandPropertyAssignment(use.parent) ? `${use.text}: ${name}` : name,
});

function apply(text: string, edits: Edit[], from = 0, to = text.length): string {
  let written = "";
  let at = from;
  for (const edit of edits.toSorted((a, b) => a.start - b.start || a.end - b.end)) {
    written += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return written + text.slice(at, to);
}

function once(path: string, text: string, random: Random): string | undefined {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (isBroken(source)) return undefined;
  const taken = new Set<string>();
  const declaredAtTop = new Map<string, number>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      taken.add(node.text);
      const holder = ts.isVariableDeclaration(node.parent) ? node.parent.parent.parent : node.parent;
      if (isDeclared(node) && holder.parent === source)
        declaredAtTop.set(node.text, (declaredAtTop.get(node.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const edits: Edit[] = [];
  for (const declaration of source.statements) {
    if (!ts.isFunctionDeclaration(declaration) && !ts.isClassDeclaration(declaration)) continue;
    if (!declaration.name || declaration.modifiers?.length || declaredAtTop.get(declaration.name.text) !== 1) continue;
    if (ts.isFunctionDeclaration(declaration) && !declaration.body) continue;
    if (!random.chance(0.8)) continue;
    const { name } = declaration as Copied;
    const inside = findUses(declaration, name.text, name);
    if (!inside) continue;
    const users = source.statements.flatMap(statement => {
      const uses = statement === declaration ? [] : findUses(statement, name.text);
      return uses?.length ? [uses] : [];
    });
    users.slice(1).forEach((uses, index) => {
      const copy = `${name.text}_${index + 2}`;
      if (taken.has(copy)) return;
      taken.add(copy);
      const written = apply(
        text,
        inside.map(use => renamed(use, source, copy)),
        declaration.getStart(source),
        declaration.end,
      );
      edits.push({ start: declaration.end, end: declaration.end, text: `\n${written}` });
      for (const use of uses) edits.push(renamed(use, source, copy));
    });
  }
  if (!edits.length) return undefined;
  const written = apply(text, edits);
  return isBroken(ts.createSourceFile(path, written, ts.ScriptTarget.Latest, true)) ? undefined : written;
}

/** The program with a copy of its functions and classes for each user, or undefined where no two statements share one. */
export function withOwnCopies(path: string, text: string, random: Random): string | undefined {
  const first = once(path, text, random);
  // The copies of a helper still share the helpers that it calls.
  return first && random.chance(0.5) ? (once(path, first, random) ?? first) : first;
}
