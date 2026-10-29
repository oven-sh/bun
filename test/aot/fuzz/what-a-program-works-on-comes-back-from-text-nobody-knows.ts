// Writes a file of a program again so that what it works on has been handed to text that no build knows and has come back from it: `launder(E)` for an expression E, where
// `launder` is `new Function("value", process.argv[9] ?? "return value")`. The program does what it did. What a build could prove about E, which object, which function, which class, which key,
// it can now only expect: that is how nearly every call of a real package looks to it, and a small program that is all in sight never does.
//
// What is laundered is one of `whatIsLaundered`: by what E is (objects, functions, classes, keys), by where E stands (receivers, arguments, callees, results), or everything.
// ../tools/let-values-be-something-else.ts says which expressions can stand inside a call.
import ts from "typescript";
import { read } from "../tools/let-values-be-something-else";
import { Random } from "./random";

export const whatIsLaundered = ["objects", "functions", "classes", "keys", "receivers", "arguments", "callees", "results", "everything"] as const; // prettier-ignore
export type WhatIsLaundered = (typeof whatIsLaundered)[number];

const isAccess = (node: ts.Node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
const isCall = (node: ts.Node): node is ts.CallExpression | ts.NewExpression =>
  ts.isCallExpression(node) || ts.isNewExpression(node);

/** Nothing where the file has no such place, or has a `launder` of its own. */
export function laundered(path: string, text: string, what: WhatIsLaundered, random: Random): string | undefined {
  if (/\blaunder(?:Key)?\b/.test(text)) return;
  const isTyped = /\.[cm]?tsx?$/.test(path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const declared = {
    functions: new Set<string>(),
    classes: new Set<string>(),
    names: new Set<string>(),
    members: new Set<string>(),
  };
  // A store to a built-in object counts only where a build can tell which object and which member it goes to; elsewhere it is refused when it runs, and the documentation says so.
  const isStoredToOutside = (access: ts.Node) => {
    if (!isAccess(access) || !ts.isIdentifier(access.expression) || declared.names.has(access.expression.text))
      return false;
    const { parent } = access;
    return (
      (ts.isBinaryExpression(parent) &&
        parent.left === access &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ts.isDeleteExpression(parent) ||
      ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken))
    );
  };
  (function note(node: ts.Node) {
    const name = (node as ts.NamedDeclaration).name;
    if (name && ts.isIdentifier(name)) {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) declared.names.add(name.text); // prettier-ignore
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) declared.members.add(name.text); // prettier-ignore
    }
    ts.forEachChild(node, note);
  })(source);
  const nodes = new Map<string, ts.Node>();
  const keys: { start: number; end: number; text: string }[] = [];
  (function visit(node: ts.Node) {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isDecorator(node)) return; // prettier-ignore
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return;
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return; // prettier-ignore
    if (ts.isHeritageClause(node) && node.token !== ts.SyntaxKind.ExtendsKeyword) return;
    if (ts.isFunctionDeclaration(node) && node.name) declared.functions.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name) declared.classes.add(node.name.text);
    const range = `${node.getStart()}-${node.getEnd()}`;
    if (!nodes.has(range)) nodes.set(range, ts.isShorthandPropertyAssignment(node) ? node.name : node);
    // `o.k` is `o[launderKey("k")]`, and `{ k: 1 }` is `{ [launderKey("k")]: 1 }`. `__proto__:` in a literal is no key, and what `import.meta` and `new.target` are followed by is none either.
    // A method of the library that no code names is not in an executable, and the documentation says so: what is called under a key is a member that the file itself declares.
    const isCalled = !!node.parent && isCall(node.parent) && node.parent.expression === node;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && !ts.isMetaProperty(node.expression) && node.expression.kind !== ts.SyntaxKind.ImportKeyword && (!isCalled || declared.members.has(node.name.text)) && !isStoredToOutside(node))
      keys.push({ start: node.expression.getEnd(), end: node.getEnd(), text: `${node.questionDotToken ? "?." : ""}[launderKey(${JSON.stringify(node.name.text)})]` }); // prettier-ignore
    if ((ts.isPropertyAssignment(node) || (ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent))) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text !== "__proto__")
      keys.push({ start: node.name.getStart(), end: node.name.getEnd(), text: `[launderKey(${JSON.stringify(node.name.text)})]` }); // prettier-ignore
    ts.forEachChild(node, visit);
  })(source);

  const is = (node: ts.Node): Record<Exclude<WhatIsLaundered, "keys" | "everything">, boolean> => {
    const { parent } = node;
    return {
      objects: ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node),
      functions: ts.isArrowFunction(node) || ts.isFunctionExpression(node) || (ts.isIdentifier(node) && declared.functions.has(node.text)), // prettier-ignore
      classes: ts.isClassExpression(node) || (ts.isIdentifier(node) && declared.classes.has(node.text)),
      receivers: isAccess(parent) && parent.expression === node,
      arguments: isCall(parent) && !!parent.arguments?.includes(node as ts.Expression),
      callees: isCall(parent) && parent.expression === node,
      results: ts.isCallExpression(node) || ts.isAwaitExpression(node),
    };
  };
  const suited = read(path, text).places.filter(place => {
    const node = nodes.get(`${place.start}-${place.end}`);
    if (!node || what === "keys") return false;
    // In a file without `import` or `export` the parser takes `await (..)` at the top for a call.
    if (ts.isIdentifier(node) && /^(await|yield)$/.test(node.text)) return false;
    // A file that a build cannot see being loaded is not in the executable: what loads a file stays in sight.
    if (ts.isIdentifier(node) && node.text === "createRequire") return false;
    if (ts.isCallExpression(node) && /\bcreateRequire\b/.test(node.expression.getText())) return false;
    if (isCall(node.parent) && node.parent.expression === node && node.parent.arguments?.[0] && ts.isStringLiteralLike(node.parent.arguments[0]) && /^\.{1,2}\//.test(node.parent.arguments[0].text)) return false; // prettier-ignore
    if (isStoredToOutside(node.parent) && (node.parent as ts.PropertyAccessExpression).expression === node)
      return false;
    return what === "everything" ? Object.values(is(node)).some(Boolean) : is(node)[what];
  });
  const named = what === "keys" || what === "everything" ? keys : [];
  if (!suited.length && !named.length) return;
  // All such places, or three in ten of them, or all where that draws none.
  const isTaken = random.chance(0.5) ? () => true : () => random.chance(0.3);
  let places = suited.filter(isTaken);
  let renamed = named.filter(isTaken);
  if (!places.length && !renamed.length) [places, renamed] = [suited, named];

  // Only insertions, so that a place inside a place stays where it is. At one offset what closes stands in front of what opens, the inner close in front of the outer, the outer open in front of the inner.
  const edits: { at: number; order: number; text: string; until?: number }[] = [];
  for (const { start, end, isShorthand } of places) {
    edits.push({
      at: start,
      order: 1e9 - end,
      text: isShorthand ? `${text.slice(start, end)}: (launder(` : "(launder(",
    });
    edits.push({ at: end, order: -1e9 - start, text: "))" });
  }
  // A key is written anew. Nothing that is laundered lies inside one.
  for (const { start, end, text: written } of renamed) edits.push({ at: start, order: 0, text: written, until: end });
  edits.sort((a, b) => a.at - b.at || a.order - b.order);
  let written = "";
  let from = 0;
  for (const { at, text: inserted, until } of edits) {
    if (at < from) continue;
    written += text.slice(from, at) + inserted;
    from = until ?? at;
  }
  written += text.slice(from);

  // Behind the comments and the directives that a file begins with.
  const first = source.statements.find(
    statement => !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)),
  );
  const at = first ? first.getStart() : text.length;
  const moved = edits
    .filter(edit => edit.at < at)
    .reduce((sum, edit) => sum + edit.text.length - ((edit.until ?? edit.at) - edit.at), 0);
  const helpers =
    `const launder = new Function("value", process.argv[9] ?? "return value")${isTyped ? " as <V>(value: V) => V" : ""};\n` +
    (renamed.length ? `const launderKey = launder${isTyped ? " as <const K>(key: K) => K" : ""};\n` : "");
  return written.slice(0, at + moved) + helpers + written.slice(at + moved);
}
