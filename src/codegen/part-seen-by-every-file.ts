import ts from "typescript";

const enum Meaning {
  None = 0,
  Type = 1,
  Value = 2,
  Any = 3,
}

/** What a declaration must be for the identifier to name it. Where the place says nothing, anything. */
function meaningOfReference(node: ts.Identifier): Meaning {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return Meaning.None;
  if (ts.isQualifiedName(parent)) return parent.right === node ? Meaning.None : Meaning.Any;
  if (
    (ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessor(parent) ||
      ts.isSetAccessor(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isEnumMember(parent) ||
      ts.isNamedTupleMember(parent) ||
      ts.isParameter(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isVariableDeclaration(parent)) &&
    parent.name === node
  ) {
    return Meaning.None;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return Meaning.None;
  if (ts.isTypePredicateNode(parent) && parent.parameterName === node) return Meaning.None;
  if (ts.isTypeReferenceNode(parent)) return Meaning.Type;
  if (ts.isTypeQueryNode(parent)) return Meaning.Value;
  if (
    ts.isExpressionWithTypeArguments(parent) &&
    ts.isHeritageClause(parent.parent) &&
    ts.isInterfaceDeclaration(parent.parent.parent)
  ) {
    return Meaning.Type;
  }
  return Meaning.Any;
}

const declaresForEveryFile = (statement: ts.Statement) =>
  ts.isModuleDeclaration(statement) &&
  ((statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(statement.name));

function namesOtherFile(node: ts.Node): boolean {
  if (ts.isImportTypeNode(node) || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword))
    return true;
  return ts.forEachChild(node, namesOtherFile) ?? false;
}

/** The function in `f.member = value`, which gives the function a member. */
function functionGivenMember(statement: ts.Statement): ts.Identifier | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return;
  if (statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
  const target = statement.expression.left;
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return;
  return ts.isIdentifier(target.expression) ? target.expression : undefined;
}

/**
 * A file that does not name a module sees of it what the module declares for every file (`declare global`, `declare module "name"`),
 * and through that the statements of the module's top level that those declarations name, and so on. The answer is where these
 * statements stand, as pairs of byte offsets in ascending order. `asked`: the other statements that name another file. With them the
 * part asks for the same files as the whole text. It exports nothing: whoever imports from the module names it.
 */
export function rangesSeenByEveryFile(file: string, text: string): { seen: number[]; asked: number[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const declarations = new Map<string, [ts.Statement, Meaning][]>();
  const declare = (name: string, statement: ts.Statement, meaning: Meaning) => {
    const known = declarations.get(name);
    if (known) known.push([statement, meaning]);
    else declarations.set(name, [[statement, meaning]]);
  };
  const declareBinding = (name: ts.BindingName, statement: ts.Statement) => {
    if (ts.isIdentifier(name)) return declare(name.text, statement, Meaning.Value);
    for (const element of name.elements) if (!ts.isOmittedExpression(element)) declareBinding(element.name, statement);
  };
  /** `var` and functions inside a statement that is no declaration itself. */
  const declareHoisted = (node: ts.Node, statement: ts.Statement) => {
    if (ts.isVariableDeclaration(node)) declareBinding(node.name, statement);
    if (ts.isFunctionDeclaration(node) && node.name) declare(node.name.text, statement, Meaning.Value);
    if (!ts.isFunctionLike(node) && !ts.isClassLike(node))
      ts.forEachChild(node, child => declareHoisted(child, statement));
  };

  const seen = new Set<ts.Statement>();
  const kept = new Set<ts.Statement>();
  for (const statement of source.statements) {
    if (declaresForEveryFile(statement)) seen.add(statement);
    else if (ts.isFunctionDeclaration(statement)) declare(statement.name?.text ?? "default", statement, Meaning.Value);
    else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      declare(statement.name.text, statement, Meaning.Type);
    else if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement))
      declare(statement.name?.text ?? "default", statement, Meaning.Any);
    else if (ts.isImportEqualsDeclaration(statement)) declare(statement.name.text, statement, Meaning.Any);
    else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) declare(clause.name.text, statement, Meaning.Any);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) declare(bindings.name.text, statement, Meaning.Any);
      else for (const element of bindings?.elements ?? []) declare(element.name.text, statement, Meaning.Any);
    } else {
      const given = functionGivenMember(statement);
      if (given) declare(given.text, statement, Meaning.Value);
      else declareHoisted(statement, statement);
    }
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.moduleSpecifier) ||
      namesOtherFile(statement)
    ) {
      kept.add(statement);
    }
  }

  const pending = [...seen];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const meaning = meaningOfReference(node);
      for (const [statement, declared] of (meaning && declarations.get(node.text)) || []) {
        if ((declared & meaning) === 0 || seen.has(statement)) continue;
        seen.add(statement);
        pending.push(statement);
      }
    }
    ts.forEachChild(node, visit);
  };
  while (pending.length > 0) visit(pending.pop()!);

  const rangesOf = (statements: ts.Statement[]) => {
    let [position, bytes] = [0, 0];
    const bytesBefore = (end: number) => {
      bytes += Buffer.byteLength(text.slice(position, end));
      position = end;
      return bytes;
    };
    return statements.flatMap(statement => [bytesBefore(statement.getStart(source)), bytesBefore(statement.end)]);
  };
  return {
    seen: rangesOf(source.statements.filter(statement => seen.has(statement))),
    asked: rangesOf(source.statements.filter(statement => kept.has(statement) && !seen.has(statement))),
  };
}
