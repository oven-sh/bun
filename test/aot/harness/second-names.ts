// Lays a second name over the lists of a program, and one act through that name into each loop that reads the list:
//
//   const copy = [...list];                                const copy = [...list];
//   for (let i = 0; i < copy.length; i++)        >         let copySecondName = secondNameTaken ? copy : secondNameSpare;
//     sum += copy[i];                                      for (let i = 0; i < copy.length; i++) { sum += copy[i]; copySecondName[(i + 1) & 3] = 1.5; }
//
// `secondNameTaken` is `process.argv.length > 99`, which no build can decide, and the spare list holds anything. So the run acts on the spare
// list and prints what it printed before, while whoever reasons about the program has to take the store for a store into `copy`: what was
// known of the list in front of it (its kind, its length, that it has no holes) may not be carried across it.
// With `isTaken` the name does name the list, and the program is held against plain Bun running the same text.
// The same for two more kinds of thing: an object whose field a loop reads, with an act that changes its shape or the field, and a Map or Set
// that a loop asks, with an act that takes an entry out or puts one in.
import ts from "typescript";

export const roads = ["either", "field", "variable", "element", "closure", "parameter"] as const;
export const actsOf = {
  list: ["fraction", "nan", "text", "object", "undefined", "hole", "behind", "push", "length"],
  object: ["add", "delete", "fraction", "text", "object", "undefined", "accessor", "freeze", "prototype", "computed"],
  collection: ["delete", "clear", "fraction", "text", "another"],
} as const;
export type Kind = keyof typeof actsOf;
export type Road = (typeof roads)[number];
export type Act = (typeof actsOf)[Kind][number];

export interface Options {
  /** What gets the second name: a list if nothing is said. */
  kind?: Kind;
  road: Road;
  act: Act;
  /** The second name names the list at run time too. */
  isTaken?: boolean;
  /** The element is looked at once more right behind the act, and what was seen is printed at the end. */
  observes?: boolean;
}

const makers = new Set(["slice", "map", "filter", "concat", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "with", "split"]);
const makersOfArray = new Set(["from", "of"]);
const makersOfObject = new Set(["keys", "values", "entries"]);

function unwrapped(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))
    node = node.expression;
  return node;
}

function makesList(initializer: ts.Expression): boolean {
  const made = unwrapped(initializer);
  if (ts.isArrayLiteralExpression(made)) return true;
  if (ts.isNewExpression(made)) return ts.isIdentifier(made.expression) && made.expression.text === "Array";
  if (!ts.isCallExpression(made)) return false;
  const callee = made.expression;
  if (ts.isIdentifier(callee)) return callee.text === "Array";
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const owner = callee.expression;
  if (ts.isIdentifier(owner) && owner.text === "Array") return makersOfArray.has(callee.name.text);
  if (ts.isIdentifier(owner) && owner.text === "Object") return makersOfObject.has(callee.name.text);
  return makers.has(callee.name.text);
}

const noPlainObjects = /^(Array|Map|Set|WeakMap|WeakSet|WeakRef|Promise|Proxy|RegExp|Date|ArrayBuffer|SharedArrayBuffer|DataView|[A-Za-z0-9]*Array|[A-Za-z]*Error)$/;

function makesObject(initializer: ts.Expression): boolean {
  const made = unwrapped(initializer);
  if (ts.isObjectLiteralExpression(made)) return true;
  if (ts.isNewExpression(made)) return ts.isIdentifier(made.expression) && !noPlainObjects.test(made.expression.text);
  if (!ts.isCallExpression(made) || !ts.isPropertyAccessExpression(made.expression)) return false;
  const owner = made.expression.expression;
  return ts.isIdentifier(owner) && owner.text === "Object" && /^(create|assign|fromEntries)$/.test(made.expression.name.text);
}

function makesCollection(initializer: ts.Expression): "Map" | "Set" | undefined {
  const made = unwrapped(initializer);
  if (!ts.isNewExpression(made) || !ts.isIdentifier(made.expression)) return;
  return made.expression.text === "Map" || made.expression.text === "Set" ? made.expression.text : undefined;
}

const isLoop = (node: ts.Node): node is ts.IterationStatement => ts.isIterationStatement(node, false);
const isBroken = (source: ts.SourceFile) => !!(source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length;
const isDirective = (statement: ts.Statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);

function isWritten(read: ts.ElementAccessExpression | ts.PropertyAccessExpression): boolean {
  const parent = read.parent;
  if (ts.isBinaryExpression(parent) && parent.left === read)
    return parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  return ts.isDeleteExpression(parent) || ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent);
}

interface List {
  name: string;
  /** What the loops are looked for in, from `from` on. */
  scope: ts.Node;
  from: number;
  /** Where the second name is declared. */
  at: number;
  /** For a parameter that can be followed by another one: the end of the list of parameters. */
  endOfParameters?: number;
  /** For what `new Set` made. */
  isSet?: boolean;
}

/** Nothing where the program has nothing of that kind that a loop reads. `lists`: how many got an act. */
export function withSecondNames(path: string, text: string, options: Options): { text: string; lists: number } | undefined {
  try {
    return lay(path, text, options);
  } catch (error) {
    // A stored program may be nested deeper than the parser's stack goes.
    if (error instanceof RangeError) return;
    throw error;
  }
}

function lay(path: string, text: string, options: Options): { text: string; lists: number } | undefined {
  // A stored program that writes down what it prints or how its build fails does so because plain Bun does something else: plain Bun is no judge of it.
  if (/^\/\* (Output|Build errors):/m.test(text)) return;
  const kind = options.kind ?? "list";
  if (!(actsOf[kind] as readonly string[]).includes(options.act)) return;
  if (/secondName/i.test(text)) return;
  const isTyped = /\.[cm]?tsx?$/.test(path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (isBroken(source) || !source.statements.length) return;
  const anyList = !isTyped ? "" : kind === "list" ? ": any[]" : ": any";
  const asAny = (name: string) => (isTyped ? `(${name} as any)` : name);

  const lists: List[] = [];
  const collect = (node: ts.Node, scope: ts.Node) => {
    if (ts.isFunctionLike(node)) {
      const body = "body" in node && node.body && ts.isBlock(node.body) ? node.body : undefined;
      if (!body) return void ts.forEachChild(node, child => collect(child, scope));
      const first = body.statements.find(statement => !isDirective(statement));
      const takesMore =
        !ts.isAccessor(node) &&
        !body.statements.some(isDirective) &&
        node.parameters.every(parameter => !parameter.dotDotDotToken) &&
        text[node.parameters.end] !== "=" &&
        /^\s*,?\s*\)/.test(text.slice(node.parameters.end));
      for (const parameter of first ? node.parameters : []) {
        if (!ts.isIdentifier(parameter.name) || parameter.name.text === "this" || parameter.dotDotDotToken) continue;
        lists.push({
          name: parameter.name.text,
          scope: body,
          from: body.pos,
          at: first!.getStart(source),
          endOfParameters: takesMore && !/,\s*$/.test(text.slice(node.parameters.pos, node.parameters.end)) ? node.parameters.end : undefined,
        });
      }
      return void ts.forEachChild(body, child => collect(child, body));
    }
    if (ts.isVariableStatement(node) && (ts.isBlock(node.parent) || ts.isSourceFile(node.parent) || ts.isCaseOrDefaultClause(node.parent))) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const made = kind === "list" ? makesList(declaration.initializer) : kind === "object" ? makesObject(declaration.initializer) : makesCollection(declaration.initializer);
        // The second name is known in the block of the declaration and nowhere else.
        if (made) lists.push({ name: declaration.name.text, scope: node.parent, from: node.end, at: node.end, isSet: made === "Set" });
      }
    }
    ts.forEachChild(node, child => collect(child, scope));
  };
  collect(source, source);

  const insertions: { at: number; text: string }[] = [];
  let numberOfLists = 0;
  const taken = new Set<string>();
  for (const list of lists) {
    const second = `${list.name}SecondName`;
    const key = `${list.scope.pos}:${list.name}`;
    if (taken.has(key)) continue;

    const places: { at: number; before?: number; index: string }[] = [];
    const isNamed = (node: ts.Node) => ts.isIdentifier(node) && node.text === list.name;
    // Only a counter that a `for` starts at a written number is sure to be a number: `(n + 1) & 3` throws for a BigInt.
    const indexOf = (read: ts.Node | undefined, loop?: ts.IterationStatement) => {
      if (read && ts.isPropertyAccessExpression(read)) return read.name.text;
      if (read && ts.isCallExpression(read)) {
        const key = read.arguments.length ? unwrapped(read.arguments[0]) : undefined;
        return key && (ts.isIdentifier(key) || ts.isNumericLiteral(key) || ts.isStringLiteral(key)) ? key.getText(source) : "0";
      }
      if (kind !== "list") return "0";
      const argument = read && ts.isElementAccessExpression(read) ? unwrapped(read.argumentExpression) : undefined;
      const counters = loop && ts.isForStatement(loop) && loop.initializer && ts.isVariableDeclarationList(loop.initializer) ? loop.initializer.declarations : [];
      const isCounter =
        argument &&
        ts.isIdentifier(argument) &&
        counters.some(counter => ts.isIdentifier(counter.name) && counter.name.text === argument.text && counter.initializer && ts.isNumericLiteral(counter.initializer));
      return isCounter ? `(${argument.text} + 1) & 3` : "0";
    };
    const isRead = (node: ts.Node) => {
      if (kind === "list") return ts.isElementAccessExpression(node) && isNamed(node.expression) && !isWritten(node);
      if (kind === "object")
        return (
          ts.isPropertyAccessExpression(node) &&
          isNamed(node.expression) &&
          ts.isIdentifier(node.name) &&
          !isWritten(node) &&
          !(ts.isCallExpression(node.parent) && node.parent.expression === node)
        );
      return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isNamed(node.expression.expression) && /^(get|has)$/.test(node.expression.name.text);
    };
    const findFirstRead = (node: ts.Node): ts.Node | undefined => {
      if (ts.isFunctionLike(node)) return;
      if (isRead(node)) return node;
      return ts.forEachChild(node, findFirstRead);
    };
    const look = (node: ts.Node) => {
      if (ts.isFunctionLike(node)) return;
      if (isLoop(node) && node.pos >= list.from) {
        const walksList = kind !== "object" && ts.isForOfStatement(node) && isNamed(node.expression);
        const body = node.statement;
        if (!ts.isBlock(body)) {
          const read = findFirstRead(body);
          if (read || walksList) places.push({ before: body.getStart(source), at: body.end, index: indexOf(read, node) });
          return;
        }
        for (const statement of body.statements) {
          const read = isLoop(statement) ? undefined : findFirstRead(statement);
          if (!read && !(walksList && statement === body.statements[0])) continue;
          places.push({ at: statement.end, index: indexOf(read, node) });
          break;
        }
      }
      // What is known of an object or a Map is carried from one read to the next without a loop too.
      if (kind !== "list" && (ts.isBlock(node) || ts.isSourceFile(node))) {
        const statements = node.statements.filter(statement => statement.pos >= list.from && !ts.isFunctionDeclaration(statement));
        const first = statements.findIndex(statement => !isLoop(statement) && findFirstRead(statement));
        if (first >= 0 && statements.slice(first + 1).some(statement => findFirstRead(statement)) && !places.some(place => place.at === statements[first].end))
          places.push({ at: statements[first].end, index: indexOf(findFirstRead(statements[first])) });
      }
      ts.forEachChild(node, look);
    };
    look(list.scope);
    if (!places.length) continue;
    taken.add(key);
    numberOfLists++;

    const spare = list.isSet ? "secondNameSpareSet" : "secondNameSpare";
    const shared = list.isSet ? "secondNameSharedSet" : "secondNameShared";
    const chosen = `secondNameTaken ? ${asAny(list.name)} : ${spare}`;
    let road = options.road;
    if (road === "parameter" && list.endOfParameters === undefined) road = "either";
    let named = second;
    // Behind a declaration, which may end without one.
    const semicolon = list.at === list.from ? ";" : "";
    switch (road) {
      case "either":
        insertions.push({ at: list.at, text: `${semicolon} let ${second}${anyList} = ${chosen}; ` });
        break;
      case "field":
        insertions.push({ at: list.at, text: `${semicolon} const ${second} = { c: ${spare} }; if (secondNameTaken) ${second}.c = ${asAny(list.name)}; ` });
        named = `${second}.c`;
        break;
      case "variable":
        insertions.push({ at: list.at, text: `${semicolon} if (secondNameTaken) ${shared} = ${asAny(list.name)}; ` });
        named = shared;
        break;
      case "element":
        insertions.push({ at: list.at, text: `${semicolon} const ${second} = [${spare}]; if (secondNameTaken) ${second}[0] = ${asAny(list.name)}; ` });
        named = `${second}[0]`;
        break;
      case "closure":
        insertions.push({ at: list.at, text: `${semicolon} const ${second} = ()${anyList} => (${chosen}); ` });
        named = `${second}()`;
        break;
      case "parameter":
        insertions.push({ at: list.endOfParameters!, text: `, ${second}${anyList} = ${chosen}` });
        break;
    }
    for (const place of places) {
      const at = kind === "object" ? `${named}.${place.index}` : `${named}[${place.index}]`;
      const put = (value: string) => (list.isSet ? `${named}.add(${value});` : `${named}.set(${place.index}, ${value});`);
      const actsOfKind: Record<string, string> = {
        list: {
          fraction: `${at} = 1.5;`,
          nan: `${at} = NaN;`,
          text: `${at} = "t";`,
          object: `${at} = {};`,
          undefined: `${at} = undefined;`,
          hole: `delete ${at};`,
          behind: `if (${named}.length < 64) ${named}[${named}.length + 1] = 0;`,
          push: `if (${named}.length < 64) ${named}.push(0);`,
          length: `${named}.length = 2;`,
        },
        object: {
          add: `${named}.secondNameAdded = 1;`,
          delete: `delete ${at};`,
          fraction: `${at} = 1.5;`,
          text: `${at} = "t";`,
          object: `${at} = {};`,
          undefined: `${at} = undefined;`,
          accessor: `Object.defineProperty(${named}, "${place.index}", { get() { return 1; }, configurable: true });`,
          freeze: `Object.freeze(${named});`,
          prototype: `Object.setPrototypeOf(${named}, null);`,
          computed: `${named}[process.argv[98] ?? "${place.index}"] = 1;`,
        },
        collection: {
          delete: `${named}.delete(${place.index});`,
          clear: `${named}.clear();`,
          fraction: put("1.5"),
          text: put('"t"'),
          another: `if (${named}.size < 64) ${list.isSet ? `${named}.add({});` : `${named}.set({}, 0);`}`,
        },
      }[kind];
      const act = actsOfKind[options.act];
      const seen = { list: `(typeof ${asAny(list.name)}[${place.index}]).length`, object: `(typeof ${asAny(list.name)}.${place.index}).length`, collection: `${asAny(list.name)}.size` }[kind];
      const look = options.observes ? ` secondNameSeen = (secondNameSeen + ${seen}) | 0;` : "";
      if (place.before !== undefined) insertions.push({ at: place.before, text: "{ " });
      insertions.push({ at: place.at, text: `; ${act}${look}${place.before !== undefined ? " }" : ""}` });
    }
  }
  if (!numberOfLists) return;

  const first = source.statements.find(statement => !isDirective(statement)) ?? source.statements[0];
  insertions.push({
    at: first.getStart(source),
    text:
      `const secondNameTaken = process.argv.length ${options.isTaken ? "<" : ">"} 99; ` +
      {
        list: `const secondNameSpare${anyList} = []; try { JSON.parse("{"); } catch (e) { secondNameSpare.push(e); } `,
        object: `const secondNameSpare${anyList} = JSON.parse("{}"); `,
        collection:
          `const secondNameSpare${anyList} = new Map(); const secondNameSpareSet${anyList} = new Set(); ` +
          `try { JSON.parse("{"); } catch (e) { secondNameSpare.set(e, e); secondNameSpareSet.add(e); } let secondNameSharedSet${anyList} = secondNameSpareSet; `,
      }[kind] +
      `let secondNameShared${anyList} = secondNameSpare; let secondNameSeen = 0; `,
  });
  let result = text;
  // Of two insertions at one place the one that was noted first comes to stand first.
  insertions
    .map((insertion, order) => ({ ...insertion, order }))
    .sort((a, b) => b.at - a.at || b.order - a.order)
    .forEach(({ at, text }) => (result = result.slice(0, at) + text + result.slice(at)));
  if (options.observes) result += `\nconsole.log("seen through the first names: " + secondNameSeen);\n`;
  return { text: result, lists: numberOfLists };
}

/** Every road with every act. */
export const variantsOf = (kind: Kind): Options[] => roads.flatMap(road => actsOf[kind].map(act => ({ kind, road, act })));
export const allVariants = variantsOf("list");

/** `number` of them, from a place that the name decides; the step meets each road and each act in turn. */
export function variantsFor(name: string, kind: Kind, number: number): Options[] {
  const all = variantsOf(kind);
  let step = 7;
  const haveCommonFactor = (a: number, b: number): boolean => (b ? haveCommonFactor(b, a % b) : a !== 1);
  while (haveCommonFactor(all.length, step)) step += 2;
  return Array.from({ length: Math.min(number, all.length) }, (_, index) => all[((hashOf(name) % all.length) + index * step) % all.length]);
}

export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}
