// Rewrites a program so that it holds code which this run never takes: `if (neverTaken) point.x = "s";`, where `neverTaken` is
// `process.argv.length > 99`, which no build can decide. The output stays the same. But whoever reasons about the program has to take
// that code for possible: a variable may hold another kind of value, a field may be gone or be an accessor, an object may have another
// prototype or be known to everybody, a parameter may be an object of another class with a field of the same name.
// It is aimed: it stands right in front of a statement inside one of the program's own functions or loops, it is done to a variable which
// that statement names, and to a field which the program uses on that variable. A file gets one or two kinds of such code: some kinds make
// a compiler give up on a value altogether, and beside them the others would show nothing.
import ts from "typescript";
import { Random } from "./random";

interface Name {
  name: string;
  isConstant: boolean;
  /** For a parameter: where the body of its function starts. */
  start?: number;
}

const allKinds = ["variable", "variable", "variable", "no turn", "no turn", "no turn", "another class", "another class", "another class", "field", "field", "delete", "accessor", "prototype", "escape", "helper"] as const; // prettier-ignore

const isNoDirective = (statement: ts.Statement) =>
  !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression));
const isBroken = (source: ts.SourceFile) =>
  !!(source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length;

/** Nothing if the file has no function with a variable to do something to, or has its own `neverTaken`. */
export function withWhatNeverRuns(path: string, text: string, random: Random): string | undefined {
  if (/\bneverTaken/i.test(text)) return;
  const isTyped = /\.[cm]?tsx?$/.test(path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (isBroken(source)) return;
  const fieldsOf = new Map<string, Set<string>>();
  const places: { at: number; names: Name[] }[] = [];

  const namedIn = (statement: ts.Node) => {
    const found = new Set<string>();
    const look = (node: ts.Node) => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isIdentifier(node)) found.add(node.text);
      ts.forEachChild(node, look);
    };
    look(statement);
    return found;
  };
  const visit = (node: ts.Node, names: Name[], isInFunction: boolean) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      ts.isIdentifier(node.expression) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      if (!fieldsOf.has(node.expression.text)) fieldsOf.set(node.expression.text, new Set());
      fieldsOf.get(node.expression.text)!.add(node.name.text);
    }
    if (ts.isFunctionLike(node)) {
      const body = "body" in node && node.body && ts.isBlock(node.body) ? node.body : undefined;
      const start = body?.statements.find(isNoDirective)?.getStart(source);
      names = node.parameters.flatMap(parameter =>
        ts.isIdentifier(parameter.name) && parameter.name.text !== "this"
          ? [{ name: parameter.name.text, isConstant: false, start }]
          : [],
      );
      isInFunction = true;
    }
    if (ts.isBlock(node) && isInFunction) {
      const known = names.slice();
      for (const statement of node.statements) {
        const used = namedIn(statement);
        const aimed = known.filter(({ name }) => used.has(name));
        if (aimed.length) places.push({ at: statement.getStart(source), names: aimed });
        visit(statement, known, true);
        if (!ts.isVariableStatement(statement)) continue;
        const isConstant = !!(statement.declarationList.flags & ts.NodeFlags.Const);
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name)) known.push({ name: declaration.name.text, isConstant });
      }
      return;
    }
    ts.forEachChild(node, child => visit(child, names, isInFunction));
  };
  visit(source, [], false);
  const first = source.statements.find(isNoDirective);
  if (!places.length || !first) return;

  const any = isTyped ? " as any" : "";
  const loose = (name: string) => (isTyped ? `(${name} as any)` : name);
  const everyField = [...new Set([...fieldsOf.values()].flatMap(fields => [...fields]))];
  const helped = new Set<string>();
  const kinds = random.sample(allKinds, random.between(1, 2));
  const share = random.pick([0.3, 0.6, 1]);
  const edits: [at: number, text: string][] = [];
  const mayBeOfTheOtherClass = new Set<string>();
  const actionOn = ({ name, isConstant, start }: Name) => {
    const kind = random.pick(kinds);
    const isStoreToTheVariable = kind === "variable" || kind === "no turn" || kind === "another class";
    if (isConstant && isStoreToTheVariable) return;
    const own = [...(fieldsOf.get(name) ?? [])];
    if (!own.length && !isStoreToTheVariable && kind !== "prototype" && kind !== "escape") return;
    const field = own.length ? random.pick(own) : everyField.length ? random.pick(everyField) : "n";
    const other = random.pick([`[${name}]`, "null", '"s"', `{ v: ${name} }`, "1.5", "undefined", "() => 1"]);
    const help = () => (helped.add(field), `neverTakenAddsTo_${field}(${name}${any});`);
    switch (kind) {
      case "variable":
        return `if (neverTaken) ${name} = (${other})${any};`;
      case "no turn":
        return `while (${name} !== ${name}) ${name} = [${name}]${any};`;
      case "another class": {
        // A parameter becomes one at the start of its function, so that it stays the same object all through a loop.
        const becomes = `if (neverTaken) ${name} = new NeverTakenKind()${any}; `;
        const isAhead = start !== undefined;
        if (isAhead && !mayBeOfTheOtherClass.has(`${start} ${name}`)) edits.push([start, becomes]);
        mayBeOfTheOtherClass.add(`${start} ${name}`);
        return `${isAhead ? "" : becomes}if (${loose(name)} instanceof NeverTakenKind) ${help()}`;
      }
      case "field":
        return `if (neverTaken) ${loose(name)}.${field} = ${other};`;
      case "delete":
        return `if (neverTaken) delete ${loose(name)}.${field};`;
      case "accessor":
        return `if (neverTaken) Object.defineProperty(${name}, "${field}", { get() { return 1; }, configurable: true });`;
      case "prototype":
        return `if (neverTaken) Object.setPrototypeOf(${name}, ${random.pick(["null", "{}", "Array.prototype"])});`;
      case "escape":
        return `if (neverTaken) ${loose("globalThis")}.neverTakenKeeps = ${name};`;
      default:
        return `if (neverTaken) ${help()}`;
    }
  };

  for (const place of places) {
    if (!random.chance(share)) continue;
    const action = actionOn(random.pick(place.names));
    if (action) edits.push([place.at, action + " "]);
  }
  if (!edits.length) return;
  edits.push([
    first.getStart(source),
    `var neverTaken = process.argv.length > 99;
class NeverTakenKind { ${[...helped].map(field => `${field} = 1; `).join("")}neverTakenStep = 3; }
${[...helped].map(field => `function neverTakenAddsTo_${field}(o${isTyped ? ": NeverTakenKind" : ""}) { o.${field} = (o.${field} + o.neverTakenStep) | 0; }\n`).join("")}`,
  ]);
  let written = text;
  for (const [at, added] of edits.sort((a, b) => b[0] - a[0]))
    written = written.slice(0, at) + added + written.slice(at);
  return isBroken(ts.createSourceFile(path, written, ts.ScriptTarget.Latest, true)) ? undefined : written;
}
