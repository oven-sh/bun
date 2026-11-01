// In a very large program a function is compiled as hot code only if at least four functions call it, and a generated
// program calls its functions from the top of the file alone. Here the statements at the top that do the work stand in
// four functions with the same body, each called twice out of a loop at the top. Declarations stay where they were, and
// so do the variables that they name. Built with --aot-limit=MaxWarmCodeValues:1 (the mode "large") the program is then
// compiled as the hot part of a very large one. It prints more than before; it is compared with the same text run plainly.
import ts from "typescript";

const isBroken = (source: ts.SourceFile) =>
  (source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0;

const isFunctionOrClass = (node: ts.Node | undefined) =>
  !!node && (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isClassExpression(node));

function isDeclaration(statement: ts.Statement): boolean {
  if (ts.isVariableStatement(statement))
    return (
      !!statement.modifiers?.length ||
      statement.declarationList.declarations.every(declaration => isFunctionOrClass(declaration.initializer))
    );
  return (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement) ||
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement)
  );
}

/** Whether the statement itself waits: a function that can suspend does not count as a caller. */
function awaits(node: ts.Node): boolean {
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
  if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && !!node.awaitModifier)) return true;
  // In a file without an import or an export the parser takes `await (x)` for a call.
  if (ts.isIdentifier(node) && node.text === "await") return true;
  if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing)
    return true;
  return !!ts.forEachChild(node, child => awaits(child) || undefined);
}

function addNames(node: ts.Node, names: Set<string>) {
  if (ts.isIdentifier(node)) names.add(node.text);
  ts.forEachChild(node, child => addNames(child, names));
}

function declares(name: ts.BindingName, names: Set<string>): boolean {
  if (ts.isIdentifier(name)) return names.has(name.text);
  return name.elements.some(element => !ts.isOmittedExpression(element) && declares(element.name, names));
}

/** The program with its work done by four functions, or undefined where nothing at its top can move into a function. */
export function withFourCallers(path: string, text: string): string | undefined {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (isBroken(source)) return undefined;
  const all = new Set<string>();
  addNames(source, all);
  const stays = new Set<ts.Statement>();
  const named = new Set<string>();
  const keep = (statement: ts.Statement) => (stays.add(statement), addNames(statement, named));
  let isPrologue = true;
  for (const statement of source.statements) {
    isPrologue &&= ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
    if (isPrologue || isDeclaration(statement) || awaits(statement)) keep(statement);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const statement of source.statements) {
      if (stays.has(statement) || !ts.isVariableStatement(statement)) continue;
      if (!statement.declarationList.declarations.some(declaration => declares(declaration.name, named))) continue;
      keep(statement);
      grew = true;
    }
  }
  const written = (statement: ts.Statement) => text.slice(statement.getFullStart(), statement.end);
  const body = source.statements
    .filter(statement => !stays.has(statement))
    .map(written)
    .join("");
  if (!body.trim()) return undefined;
  const free = (name: string) => {
    while (all.has(name)) name += "_";
    return name;
  };
  const callers = ["driveA", "driveB", "driveC", "driveD"].map(free);
  const round = free("round");
  const top = source.statements
    .filter(statement => stays.has(statement))
    .map(written)
    .join("");
  const dressed = `${top}\n${callers.map(caller => `function ${caller}() {${body}\n}`).join("\n")}
for (let ${round} = 0; ${round} < 2; ${round}++) {
${callers.map(caller => `  ${caller}();`).join("\n")}
}
`;
  return isBroken(ts.createSourceFile(path, dressed, ts.ScriptTarget.Latest, true)) ? undefined : dressed;
}
