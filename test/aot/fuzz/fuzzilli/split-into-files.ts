// Cuts functions and classes of a generated program out into other files, so that calls and values cross from file to file.
//
// The program moves into a folder of its own, ./split-<hash>/main<extension>, and what the driver lays out as the program only imports that file.
// A part is TypeScript, JavaScript (the same text with its types erased) or a package in node_modules. It imports the names of main that it uses, so the two files import each other.
// What main is told about a part in JavaScript is drawn: a declaration file that is right, one that is wrong, one that isn't valid, none and `allowJs`, none and no `allowJs`.
// A part in TypeScript can have annotations that its own code doesn't fit, below `// @ts-nocheck`. The folder can have a tsconfig.json whose options are drawn.
// A package of TypeScript can ship its sources as a project does: several files below src, a tsconfig.json of its own with other options than main's, and a file that only `import type` reaches.
// A part in JavaScript can also call functions of main with arguments of other types and in other numbers, by their names and as callbacks that main hands over.
import { randomFrom } from "./print-members-of-objects.ts";

const identifier = String.raw`[A-Za-z_$][\w$]*`;
const openers = "([{<";
const closers = ")]}>";

/** The index of the bracket that closes the one at `at`. Skips strings, and the ">" of "=>". */
function closingBracket(text: string, at: number) {
  const stack: string[] = [];
  for (let index = at; index < text.length; index++) {
    const character = text[index];
    if (character === '"' || character === "'" || character === "`") {
      for (index++; index < text.length && text[index] !== character; index++) if (text[index] === "\\") index++;
      continue;
    }
    if (character === ">" && (text[index - 1] === "=" || stack.at(-1) !== "<")) continue;
    if (character === "<" && stack.length && stack.at(-1) !== "<" && !/[\w$]/.test(text[index - 1] ?? "")) continue;
    if (openers.includes(character)) stack.push(character);
    else if (closers.includes(character)) {
      while (stack.length && stack.at(-1) === "<" && character !== ">") stack.pop();
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

/** `text` cut at each `separator` that stands outside of every bracket and string. */
function splitOutsideBrackets(text: string, separator: string) {
  const pieces: string[] = [];
  let from = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.startsWith(separator, index)) {
      pieces.push(text.slice(from, index));
      from = index + separator.length;
      index = from - 1;
    } else if (openers.includes(text[index]) && !(text[index] === "<" && !/[\w$]/.test(text[index - 1] ?? ""))) {
      const closes = closingBracket(text, index);
      if (closes > 0) index = closes;
    } else if (text[index] === '"' || text[index] === "'") {
      const quote = text[index];
      for (index++; index < text.length && text[index] !== quote; index++) if (text[index] === "\\") index++;
    }
  }
  pieces.push(text.slice(from));
  return pieces;
}

type Signature = { generics: string; parameters: string[]; returns: string | undefined };
/** Reads "<T>(a: T, b = 1): T {" from `at` on. */
function signatureAt(text: string, at: number): Signature | undefined {
  let generics = "";
  if (text[at] === "<") {
    const closes = closingBracket(text, at);
    if (closes < 0) return undefined;
    generics = text.slice(at, closes + 1);
    at = closes + 1;
  }
  if (text[at] !== "(") return undefined;
  const closes = closingBracket(text, at);
  if (closes < 0) return undefined;
  const inside = text.slice(at + 1, closes).trim();
  const parameters = inside ? splitOutsideBrackets(inside, ", ").map(parameter => parameter.trim()) : [];
  let returns: string | undefined;
  if (text.startsWith(": ", closes + 1)) {
    // The brace of the body follows a whole type. A brace behind ":", "|", "&", "=>" and the like opens a type.
    let index = closes + 3;
    for (; index < text.length; index++) {
      if (text[index] === ";") break;
      if (!openers.includes(text[index])) continue;
      const before = text.slice(closes + 1, index).trimEnd();
      if (text[index] === "{" && !/(?:[:|&<,(?]|=>)$/.test(before)) break;
      if (text[index] === "<" && !/[\w$]$/.test(before)) continue;
      const end = closingBracket(text, index);
      if (end < 0) return undefined;
      index = end;
    }
    returns = text.slice(closes + 3, index).trim();
  }
  return { generics, parameters, returns };
}

/** A parameter as a declaration has it: no initializer, no pattern, and a type. */
function declaredParameter(parameter: string, index: number, typeWhenNone: () => string) {
  const [target, initializer] = splitOutsideBrackets(parameter, " = ");
  const [written, ...types] = splitOutsideBrackets(
    target.replace(/^(?:(?:public|private|protected|readonly) )+/, ""),
    ": ",
  );
  const isRest = written.startsWith("...");
  let name = written.replace(/^\.\.\./, "").replace(/\?$/, "");
  if (!new RegExp(`^${identifier}$`).test(name)) name = `given${index}`;
  const isOptional = !isRest && (initializer !== undefined || written.endsWith("?"));
  const type = types.length ? types.join(": ") : isRest ? `${typeWhenNone()}[]` : typeWhenNone();
  return `${isRest ? "..." : ""}${name}${isOptional ? "?" : ""}: ${type}`;
}

const withoutCommentsAndStrings = (code: string) =>
  code
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replaceAll("...", " ");
const namesIn = (code: string) =>
  new Set(
    [...withoutCommentsAndStrings(code).matchAll(new RegExp(`(?<![.\\w$#])${identifier}`, "g"))].map(([name]) => name),
  );

/** The names that `code` may assign to. An import cannot be assigned to. */
function namesAssignedIn(code: string) {
  const text = withoutCommentsAndStrings(code);
  const names = new Set<string>();
  const target = String.raw`\(*(${identifier})(?: as any\))*`;
  const patterns = [
    String.raw`(?<![.\w$#]|[:|&] )${target}\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])`,
    String.raw`(?<![.\w$#])${target}(?:\+\+|--)`,
    String.raw`(?:\+\+|--)${target}`,
    String.raw`\bfor (?:await )?\(${target} (?:of|in)\b`,
  ];
  for (const pattern of patterns) for (const [, name] of text.matchAll(new RegExp(pattern, "g"))) names.add(name);
  // "[a, b] = c" and "({ a: b } = c)".
  for (const [, pattern] of text.matchAll(/^\s*(?:for \()?(\(?[[{].*[\]}]) (?:=|of|in) /gm))
    for (const name of namesIn(pattern)) names.add(name);
  return names;
}

type Declared = "function" | "class" | "value" | "type";
/** What the lines without indentation declare, and how often. */
function declarationsOf(lines: string[]) {
  const declared = new Map<string, Declared>();
  const times = new Map<string, number>();
  const add = (name: string, kind: Declared) => {
    times.set(name, (times.get(name) ?? 0) + (declared.get(name) === "function" && kind === "function" ? 0 : 1));
    declared.set(name, kind);
  };
  for (const line of lines) {
    let found: RegExpExecArray | null;
    if ((found = new RegExp(`^(?:async )?function\\*? ?(${identifier})`).exec(line))) add(found[1], "function");
    else if ((found = new RegExp(`^(?:abstract )?class (${identifier})`).exec(line))) add(found[1], "class");
    else if ((found = new RegExp(`^(?:(?:const |declare )*enum|namespace|module) (${identifier})`).exec(line)))
      add(found[1], "class");
    else if ((found = new RegExp(`^(?:interface|type) (${identifier})`).exec(line))) add(found[1], "type");
    else if ((found = new RegExp(`^(?:const|let|var|using|await using) (${identifier})`).exec(line)))
      add(found[1], "value");
    else if ((found = /^(?:const|let|var) ([[{].*?[\]}]) = /.exec(line)))
      for (const name of namesIn(found[1])) add(name, "value");
    else if ((found = /^import (type )?(.*?) from /.exec(line))) {
      const [, isType, clause] = found;
      for (const piece of clause.replace(/[{}]/g, ",").split(",")) {
        const [, type, name] = new RegExp(`^\\s*(type )?(?:.* as )?(${identifier})\\s*$`).exec(piece) ?? [];
        if (name) add(name, isType || type ? "type" : "value");
      }
    }
  }
  return { declared, times };
}

type Item = {
  name: string;
  kind: "function" | "class" | "constant" | "variable";
  /** Variables of main that it assigns to. It can only move together with them. */
  assigns: string[];
  first: number;
  last: number;
  indent: number;
  text: string[];
  /** Names of main that it mentions. */
  mentions: string[];
  /** A class whose definition reads variables of main is defined where it stood, by a function of the part that returns it. */
  throughAFunction: boolean;
};

const primitives = ["number", "string", "boolean", "bigint", "symbol", "undefined", "null", "void", "object"];
const otherTypes = [
  "never",
  "1",
  '"text"',
  "true",
  "number[]",
  "string[]",
  "[number, string]",
  "{ a: number }",
  "{ length: string }",
  "() => number",
  "Map<string, number>",
  "Promise<number>",
  "Uint8Array",
  "Date",
  "RegExp",
];
/** Arguments that a part in JavaScript hands to functions of main. */
const argumentLists = [
  "[]",
  "[undefined]",
  "[null, null]",
  '["text"]',
  '["", 1.5, true]',
  "[-0, NaN, 2 ** 31]",
  "[1n]",
  "[{}]",
  '[[], [1, "a"], {}]',
  '[{ valueOf() { return 7; } }, { toString() { return "seven"; } }]',
  "[() => 1, function () { return this; }]",
  "[Object.create(null)]",
  "[new Map([[1, 2]]), new Set([1])]",
  "[Symbol.iterator]",
  "[1, 2, 3, 4, 5, 6, 7, 8, 9]",
  "[new Proxy({}, {})]",
  '[{ length: -1 }, { a: "a", b: 2 }]',
  "[new Uint8Array(2), new Float64Array([1.5])]",
];
const invalidDeclarations = [
  "export const neverDefined: MissingType;",
  "export interface DeclaredTwice { a: number; a: string; }",
  'declare const initialized: number = "text";',
  "export type Circular = Circular[] | Circular;",
  "export function overloaded(): number;\nexport const overloaded: string;",
  "export class Unfinished extends MissingBase<number> { member: AlsoMissing; }",
  "export declare function withBody(): number { return 1; }",
  "export type Applied = NotGeneric<string>;\ntype NotGeneric = number;",
];

/**
 * The text of a program with some of its functions and classes in other files, or `text` when none of them can move.
 * Behind a line "// @filename: ./<path>" stands a file. What is drawn depends on `text` alone.
 */
export function splitIntoFiles(text: string, extension: string) {
  const isTypeScript = extension.endsWith("ts");
  const [whole, ...furniture] = text.split(/^(?=\/\/ @filename: \.\/)/m);
  // A file that imports or exports is in strict mode, which has no `with`.
  if (text.includes("./split-") || /\bwith ?\(/.test(whole)) return text;
  const random = randomFrom("split" + text);
  const below = (bound: number) => Math.floor(random() * bound);
  const pick = <T>(from: readonly T[]): T => from[below(from.length)];
  const chance = (percent: number) => random() * 100 < percent;
  const cast = isTypeScript ? " as any" : "";
  // As the driver does for the file that it takes for the program: the message of an error that nothing reads goes to stderr.
  const lines = whole
    .replace(
      /\} catch ?\((e\d*)\) \{\n?\}$/gm,
      (_, caught) => `} catch (${caught}) { console.error(String((${caught}${cast})?.["message"])); }`,
    )
    .replace(/\n+$/, "")
    .split("\n");
  // What a block without indentation declares becomes a declaration of the file, which can be exported. Not where a name would be declared twice.
  if (chance(50)) {
    const count = new Map<string, number>();
    const declares = new RegExp(`^(?: {4})?(?:const|let|var|class|(?:async )?function\\*?) ?(${identifier})`);
    for (const line of lines) {
      const name = declares.exec(line)?.[1];
      if (name !== undefined) count.set(name, (count.get(name) ?? 0) + 1);
    }
    for (let first = lines.indexOf("{"); first >= 0; first = lines.indexOf("{", first + 1)) {
      const last = lines.indexOf("}", first);
      if (last < 0) break;
      const inside = lines.slice(first + 1, last);
      if (inside.some(line => (count.get(declares.exec(line)?.[1] ?? "") ?? 1) > 1)) continue;
      lines.splice(first, last - first + 1, ...inside.map(line => line.replace(/^ {4}/, "")));
    }
  }
  const { declared, times } = declarationsOf(lines);

  // What can move: functions and classes without indentation, and functions directly in a block without indentation.
  const items: Item[] = [];
  let block: { first: number; names: Set<string> } | undefined;
  for (let first = 0; first < lines.length; first++) {
    const line = lines[first];
    if (line === "{") {
      const last = lines.indexOf("}", first);
      const names = lines
        .slice(first, last < 0 ? first : last)
        .map(
          inner => new RegExp(`^ {4}(?:const|let|var|class|(?:async )?function\\*?) (${identifier})`).exec(inner)?.[1],
        );
      block = { first, names: new Set(names.filter(name => name !== undefined)) };
      continue;
    }
    if (line === "}") block = undefined;
    // A constant whose initializer names no variable of main and prints nothing is the same wherever it is made.
    const [, keywordOfValue, constant] = new RegExp(`^(const|let) (${identifier})(?:: .*)? = `).exec(line) ?? [];
    if (constant !== undefined && times.get(constant) === 1) {
      const last = line.endsWith(";")
        ? first
        : lines.findIndex((other, index) => index > first && /^[\]})]/.test(other));
      const body = last < 0 ? [] : lines.slice(first, last + 1);
      const mentioned = namesIn(body.join("\n"));
      mentioned.delete(constant);
      const mentions = [...mentioned].filter(other => declared.has(other));
      if (
        body.at(-1)?.endsWith(";") &&
        mentions.every(other => declared.get(other) === "type") &&
        !["console", "await", "yield", "this", "import", "require"].some(word => mentioned.has(word))
      ) {
        items.push({
          name: constant,
          kind: keywordOfValue === "let" ? "variable" : "constant",
          assigns: [],
          first,
          last,
          indent: 0,
          text: body,
          mentions,
          throughAFunction: false,
        });
        first = last;
      }
      continue;
    }
    const [, spaces, keyword, name] =
      new RegExp(`^( {0,4})((?:async )?function\\*?|class) ?(${identifier})\\b`).exec(line) ?? [];
    if (name === undefined || (spaces.length !== 0 && !(spaces.length === 4 && block))) continue;
    const kind = keyword === "class" ? "class" : "function";
    if (spaces.length === 4 && (kind === "class" || declared.has(name))) continue;
    let last = first;
    // Overloads stand in front of the function.
    while (kind === "function" && lines[last].endsWith(";") && lines[last + 1]?.startsWith(`${spaces}function ${name}`))
      last++;
    if (lines[last].endsWith("{")) last = lines.indexOf(spaces + "}", last);
    else if (!lines[last].endsWith("}")) continue;
    if (last < 0) continue;
    const body = lines.slice(first, last + 1);
    const code = body.join("\n");
    const mentioned = namesIn(code);
    mentioned.delete(name);
    if (spaces.length === 4 && [...block!.names].some(other => other !== name && mentioned.has(other))) continue;
    if (spaces.length === 0 && times.get(name) !== 1) continue;
    const assigned = namesAssignedIn(code);
    const mentions = [...mentioned].filter(other => declared.has(other));
    const assigns = mentions.filter(other => declared.get(other) !== "type" && assigned.has(other));
    // `await` and `yield` of the code around it, `super` and private names of a class around it don't occur at these depths. `arguments` and `this` are the function's own.
    items.push({
      name,
      kind,
      assigns,
      first,
      last,
      indent: spaces.length,
      text: body.map(inner => inner.slice(spaces.length)),
      mentions,
      throughAFunction: kind === "class" && mentions.some(other => declared.get(other) !== "type"),
    });
    first = last;
  }
  // Names of functions in different blocks can be the same.
  const seen = new Set<string>();
  // Main cannot assign to what it imports, and neither can another part.
  const assignedAnywhere = namesAssignedIn(lines.join("\n"));
  const isValue = (item: Item) => item.kind === "constant" || item.kind === "variable";
  const able = new Set(
    items
      .filter(item => !seen.has(item.name) && seen.add(item.name))
      .filter(item => isValue(item) || !assignedAnywhere.has(item.name))
      // A generic class is a type with arguments, which a constant isn't.
      .filter(item => !(item.throughAFunction && isTypeScript && /^class [\w$]+</.test(item.text[0]))),
  );
  // A variable moves together with everything that assigns to it, into one file. So all of that must be able to move.
  const assignedOutside = namesAssignedIn(
    lines.filter((_, index) => !items.some(item => index >= item.first && index <= item.last)).join("\n"),
  );
  const byName = new Map([...able].map(item => [item.name, item]));
  for (let shrank = true; shrank; ) {
    shrank = false;
    for (const item of able) {
      const stays =
        item.assigns.some(name => byName.get(name)?.kind !== "variable" || !able.has(byName.get(name)!)) ||
        (item.kind === "variable" &&
          (assignedOutside.has(item.name) ||
            items.some(other => other.assigns.includes(item.name) && !able.has(other))));
      if (stays) shrank = able.delete(item);
    }
  }
  /** The first of the items that must share a file with `item`. */
  const leader = new Map<Item, Item>([...able].map(item => [item, item]));
  const leaderOf = (item: Item): Item => (leader.get(item) === item ? item : leaderOf(leader.get(item)!));
  for (const item of able) for (const name of item.assigns) leader.set(leaderOf(byName.get(name)!), leaderOf(item));
  const drawn = new Map<Item, boolean>();
  let moved = [...able].filter(item => {
    const first = leaderOf(item);
    if (!drawn.has(first)) drawn.set(first, chance(65));
    return drawn.get(first)!;
  });
  if (moved.length === 0 && able.size) {
    const first = leaderOf(pick([...able]));
    moved = [...able].filter(item => leaderOf(item) === first);
  }
  if (moved.length === 0) return text;

  const hash = Bun.hash.crc32(text).toString(36);
  const folder = `./split-${hash}`;
  const main = `main${extension}`;
  const isMoved = new Map(moved.map(item => [item.name, item]));

  type Part = {
    items: Item[];
    form: "ts" | "js" | "mjs" | "cjs" | "package" | "package of TypeScript" | "package with typed source";
    types: "right" | "wrong" | "invalid" | "none";
    specifier: string;
  };
  const parts: Part[] = Array.from({ length: Math.min(moved.length, 1 + below(3)) }, () => ({
    items: [],
    form: "js",
    types: "none",
    specifier: "",
  }));
  // What names nothing of main but each other can be a package. Such items often get a part to themselves.
  let free = moved;
  for (;;) {
    const names = new Set(free.map(item => item.name));
    const still = free.filter(item => item.mentions.every(other => names.has(other)));
    if (still.length === free.length) break;
    free = still;
  }
  if (free.length && free.length < moved.length && chance(60)) {
    if (parts.length === 1) parts.push({ items: [], form: "js", types: "none", specifier: "" });
    parts[0].items.push(...free);
    const others = moved.filter(item => !free.includes(item));
    others.forEach((item, index) =>
      (index + 1 < parts.length ? parts[index + 1] : pick(parts.slice(1))).items.push(item),
    );
    while (parts.at(-1)!.items.length === 0) parts.pop();
  } else moved.forEach((item, index) => (index < parts.length ? parts[index] : pick(parts)).items.push(item));
  for (const part of parts)
    for (const item of [...part.items]) {
      const home = parts.find(other => other.items.includes(leaderOf(item)))!;
      if (home === part) continue;
      part.items.splice(part.items.indexOf(item), 1);
      home.items.push(item);
    }
  for (let index = parts.length - 1; index >= 0; index--) if (parts[index].items.length === 0) parts.splice(index, 1);
  const files: [string, string][] = [];
  // Whether a manifest says that the files of the folder can be left out when nothing of them is used. Names are then more often handed on from file to file.
  const isQuiet = chance(45);
  const importsOfMain: string[] = [];
  const exportedValues = new Set<string>();
  const exportedTypes = new Set<string>();
  const endOfMain: string[] = [];
  /** Names that main knows under a type that can be wrong. */
  const doubtful = new Set<string>();
  const functionsOfMain = items.filter(item => item.kind === "function" && item.indent === 0);

  const typesOfMain = [...declared].filter(([, kind]) => kind === "type" || kind === "class").map(([name]) => name);
  const anotherType = () =>
    chance(50) ? pick(primitives) : typesOfMain.length && chance(50) ? pick(typesOfMain) : pick(otherTypes);
  const typeWhenNone = (isWrong: boolean) => () => (isWrong && chance(60) ? pick(primitives.slice(0, 4)) : "any");
  /** A declaration with one thing changed: a type, the number of parameters, or the name of a member. */
  const changed = (declaration: string) => {
    const types = [
      ...declaration.matchAll(
        /\b(?:number|string|boolean|bigint|symbol|undefined|null|void|unknown|any|object)\b(?!\??:)/g,
      ),
    ];
    const members = [
      ...declaration.matchAll(
        new RegExp(`(?<=[{;] |^ {4}(?:static |readonly |private )*)(${identifier})(?=\\??[:(])`, "gm"),
      ),
    ];
    const replaceAt = (found: RegExpMatchArray, by: string) =>
      declaration.slice(0, found.index) + by + declaration.slice(found.index! + found[0].length);
    switch (below(members.length ? 5 : 4)) {
      case 0:
      case 1:
        if (types.length) return replaceAt(pick(types), anotherType());
      // fallthrough
      case 2:
        // The result.
        if (/\): [^;]+;$/m.test(declaration)) return declaration.replace(/\): [^;\n]+;$/m, `): ${anotherType()};`);
      // fallthrough
      case 3:
        return chance(50)
          ? declaration.replace(
              /\(([^()]*)\)(?=: )/,
              (_, inside) => `(${inside ? inside + ", " : ""}oneMore: ${pick(primitives.slice(0, 3))})`,
            )
          : declaration.replace(
              /\(([^()]*)\)(?=: )/,
              (_, inside) => `(${splitOutsideBrackets(inside, ", ").slice(0, -1).join(", ")})`,
            );
      default: {
        const member = pick(members);
        return replaceAt(member, member[0] + "Renamed");
      }
    }
  };

  /** What a declaration file says about a function. */
  const declarationOfFunction = (item: Item, isWrong: boolean) => {
    const overloads = item.text.filter(line => line.startsWith("function ") && line.endsWith(";"));
    if (overloads.length) return overloads.map(line => "export " + line).join("\n");
    const header = item.text[0];
    const [start, isAsync, star] = new RegExp(`^(async )?function(\\*)? ?${identifier}`).exec(header)!;
    const signature = signatureAt(header, start.length);
    if (!signature) return `export function ${item.name}(...given: any[]): any;`;
    const parameters = signature.parameters.map((parameter, index) =>
      declaredParameter(parameter, index, typeWhenNone(isWrong)),
    );
    const returns = signature.returns ?? (isAsync || star ? "any" : typeWhenNone(isWrong)());
    return `export function ${item.name}${signature.generics}(${parameters.join(", ")}): ${returns};`;
  };
  /** What a declaration file says about a class: its fields, accessors and methods with names that are written out. */
  const declarationOfClass = (item: Item, isWrong: boolean) => {
    const [, head, base] =
      new RegExp(`^(class ${identifier}(?:<.*?>)?)(?: extends (${identifier}(?:<.*>)?))? (?:implements .*)?\\{`).exec(
        item.text[0],
      ) ?? [];
    if (!head) return `export const ${item.name}: any;`;
    const members: string[] = [];
    for (const line of item.text.slice(1, -1)) {
      const [, modifiers, accessor, name] =
        new RegExp(
          `^ {4}((?:(?:static|readonly|private|protected|public|declare|override) )*)(?:async )?((?:get|set) )?\\*?(${identifier})(?=[?!:;(<]| = )`,
        ).exec(line) ?? [];
      if (name === undefined || (name === "static" && line.trim() === "static {")) continue;
      const at = line.indexOf(name, 4 + modifiers.length) + name.length;
      const kept = modifiers.replace("declare ", "").replace("override ", "");
      if (line[at] === "(" || line[at] === "<") {
        const signature = signatureAt(line, at);
        if (!signature) continue;
        const parameters = signature.parameters.map((parameter, index) =>
          declaredParameter(parameter, index, typeWhenNone(isWrong)),
        );
        const returns = name === "constructor" || accessor === "set " ? "" : `: ${signature.returns ?? "any"}`;
        members.push(`    ${kept}${accessor ?? ""}${name}${signature.generics}(${parameters.join(", ")})${returns};`);
      } else {
        const [target] = splitOutsideBrackets(line.slice(at).replace(/;$/, ""), " = ");
        const type = /^[?!]?: (.*)$/.exec(target)?.[1] ?? typeWhenNone(isWrong)();
        members.push(`    ${kept}${name}${target.startsWith("?") ? "?" : ""}: ${type};`);
      }
    }
    return [
      `export ${head}${base && (declared.has(base.replace(/<.*/, "")) || isMoved.has(base)) ? ` extends ${base}` : ""} {`,
      ...members,
      "}",
    ].join("\n");
  };

  parts.forEach((part, number) => {
    const inPart = new Set(part.items.map(item => item.name));
    const needed = [...new Set(part.items.flatMap(item => item.mentions))].filter(name => !inPart.has(name));
    const neededValues = needed.filter(name => declared.get(name) !== "type");
    const isClosed = neededValues.length === 0;
    const usesNoName = needed.length === 0;
    part.form = pick(
      isTypeScript
        ? ([
            "js",
            "js",
            "js",
            "js",
            "mjs",
            "ts",
            "ts",
            "ts",
            "cjs",
            "package",
            "package",
            "package of TypeScript",
            "package of TypeScript",
            "package of TypeScript",
            "package with typed source",
          ] as const)
        : (["js", "js", "mjs", "cjs", "ts", "ts", "package"] as const),
    );
    if (!isClosed && (part.form === "cjs" || part.form === "package")) part.form = "js";
    // `bun run` copies what a file in CommonJS exports when it is imported, and an executable reads it each time. So a variable is exported by a module.
    const hasAVariable = part.items.some(item => item.kind === "variable");
    if (hasAVariable && part.form === "cjs") part.form = "js";
    if (!usesNoName && part.form.startsWith("package ")) part.form = isClosed ? "package" : "ts";
    part.types =
      part.form === "package of TypeScript" || part.form === "package with typed source"
        ? pick(["right", "right", "wrong"] as const)
        : pick(["right", "wrong", "wrong", "wrong", "invalid", "none", "none"] as const);
    const isWrong = part.types === "wrong" || part.types === "invalid";

    // The text of the part as TypeScript, or as the JavaScript that the program is.
    const body = part.items.flatMap(item =>
      item.throughAFunction
        ? [
            `export function make${item.name}() {`,
            `    return ${item.text[0]}`,
            ...item.text.slice(1, -1).map(line => "    " + line),
            "    };",
            "}",
          ]
        : item.text.map(line =>
            new RegExp(`^(?:(?:async )?function\\*? ?|class |const |let )${item.name}\\b`).test(line)
              ? "export " + line
              : line,
          ),
    );
    const isPackage = part.form.startsWith("package");
    const toMain = isPackage ? `../../${main}` : `./${main}`;
    const importOf = (names: string[]) =>
      names.length
        ? [
            `import { ${names.map(name => (declared.get(name) === "type" ? "type " : "") + name).join(", ")} } from "${toMain}";`,
          ]
        : [];
    for (const name of needed) (declared.get(name) === "type" ? exportedTypes : exportedValues).add(name);

    // Calls from JavaScript into main.
    const calls: string[] = [];
    const declarationsOfCalls: string[] = [];
    const callees: string[] = [];
    const isJavaScript = part.form === "js" || part.form === "mjs";
    if (isJavaScript || part.form === "cjs" || part.form === "package") {
      const shown = `(value => ((typeof value === "object" && value !== null) || typeof value === "function" ? typeof value : String(value)))`;
      const loop = (call: string) =>
        `    const ends = [];\n    for (const given of [${Array.from({ length: 2 + below(4) }, () => pick(argumentLists)).join(", ")}]) {\n        try { ends.push(${shown}(${call})); } catch (error) { ends.push("threw " + error?.constructor?.name); }\n    }\n    return ends.join();`;
      const waysToCall = (callee: string) => [
        `${callee}(...given)`,
        `${callee}(...given)`,
        `${callee}.call(given[0], ...given)`,
        `${callee}.apply(undefined, given)`,
        `Reflect.apply(${callee}, given.at(-1), given)`,
        `${callee}.bind(null, ...given)()`,
        `new ${callee}(...given)`,
      ];
      const waysToChange = [
        "for (const key of Object.keys(made)) made[key] = given[0];",
        "delete made[Object.keys(made)[0]];",
        'Object.defineProperty(made, Object.keys(made)[0] ?? "added", { get() { return given[0]; }, configurable: true });',
        "made.added = given;",
        "Object.freeze(made);",
        "Object.setPrototypeOf(made, Object.create(Object.getPrototypeOf(made)));",
        "Object.assign(made, given[0]);",
        "for (const key of Object.keys(made).reverse()) { const held = made[key]; delete made[key]; made[key] = held; }",
      ];
      for (const made of items
        .filter(item => item.kind === "class" && !inPart.has(item.name) && chance(40))
        .slice(0, 2)) {
        const name = `callChanged${made.name}In${number}`;
        calls.push(
          `export function ${name}(Class) {\n    const ends = [];\n    for (const given of [${Array.from({ length: 1 + below(3) }, () => pick(argumentLists)).join(", ")}]) {\n        try {\n            const made = new Class(...given);\n            ${pick(waysToChange)}\n            for (const name of Object.getOwnPropertyNames(Class.prototype)) {\n                if (name === "constructor") continue;\n                try { ends.push(name + " " + ${shown}(typeof made[name] === "function" ? made[name](...given) : made[name])); } catch (error) { ends.push(name + " threw " + error?.constructor?.name); }\n            }\n            ends.push(Object.keys(made).join("+"));\n        } catch (error) { ends.push("threw " + error?.constructor?.name); }\n    }\n    return ends.join();\n}`,
        );
        declarationsOfCalls.push(`export function ${name}(Class: typeof ${made.name}): string;`);
        callees.push(made.name);
        exportedValues.add(made.name);
        endOfMain.push(`printValue("${made.name} changed in part ${number}", ${name}(${made.name}));`);
        inPart.add(name);
      }
      for (const callee of functionsOfMain.filter(item => !inPart.has(item.name) && chance(35)).slice(0, 3)) {
        const isConstructor = /^[A-Z]/.test(callee.name);
        if (isJavaScript && chance(50)) {
          callees.push(callee.name);
          exportedValues.add(callee.name);
          calls.push(
            `export function call${callee.name}Otherwise${number}() {\n${loop(isConstructor ? `new ${callee.name}(...given)` : pick(waysToCall(callee.name)))}\n}`,
          );
          declarationsOfCalls.push(`export function call${callee.name}Otherwise${number}(): string;`);
          endOfMain.push(
            `printValue("${callee.name} called from part ${number}", call${callee.name}Otherwise${number}());`,
          );
          inPart.add(`call${callee.name}Otherwise${number}`);
        } else {
          const name = `callBack${callee.name}In${number}`;
          calls.push(
            `export function ${name}(callback) {\n${loop(isConstructor ? "new callback(...given)" : pick(waysToCall("callback")))}\n}`,
          );
          declarationsOfCalls.push(`export function ${name}(callback: typeof ${callee.name}): string;`);
          callees.push(callee.name);
          exportedValues.add(callee.name);
          endOfMain.push(`printValue("${callee.name} called back in part ${number}", ${name}(${callee.name}));`);
          inPart.add(name);
        }
      }
    }
    const exportsOfPart = [
      ...part.items.map(item => (item.throughAFunction ? `make${item.name}` : item.name)),
      ...[...inPart].filter(name => /^call(?:Back|Changed)?[\w$]+(?:Otherwise|In)\d+$/.test(name)),
    ];

    const declarations = () => {
      let texts = part.items.map(item =>
        item.throughAFunction
          ? `export function make${item.name}(): ${isWrong && chance(40) ? pick([...primitives, ...otherTypes]) : "any"};`
          : item.kind === "class"
            ? declarationOfClass(item, isWrong)
            : isValue(item)
              ? `export ${item.kind === "variable" ? "let" : "const"} ${item.name}: ${/^(?:const|let) [\w$]+: (.*)$/.exec(splitOutsideBrackets(item.text[0], " = ")[0])?.[1] ?? typeWhenNone(isWrong)()};`
              : declarationOfFunction(item, isWrong),
      );
      if (isWrong) {
        const at = below(texts.length);
        texts = texts.map((declaration, index) => (index === at || chance(40) ? changed(declaration) : declaration));
        // One that is left out.
        if (texts.length > 1 && chance(15)) texts.splice(below(texts.length), 1);
      }
      if (part.types === "invalid")
        for (let count = 1 + below(3); count > 0; count--)
          texts.splice(below(texts.length + 1), 0, pick(invalidDeclarations));
      texts.push(...declarationsOfCalls);
      const mentioned = namesIn(texts.join("\n"));
      const imported = [...declared.keys()].filter(
        name =>
          mentioned.has(name) &&
          !inPart.has(name) &&
          !isMoved.has(name) &&
          (declared.get(name) !== "value" || callees.includes(name)),
      );
      const callbacks = callees.filter(name => mentioned.has(name) && !imported.includes(name) && !inPart.has(name));
      for (const name of imported) (declared.get(name) === "type" ? exportedTypes : exportedValues).add(name);
      const all = [...imported, ...callbacks];
      return [...(all.length ? [`import type { ${all.join(", ")} } from "${toMain}";`] : []), ...texts, ""].join("\n");
    };
    const erased = (typed: string) =>
      isTypeScript ? new Bun.Transpiler({ loader: "ts" }).transformSync(typed) : typed;
    // The code comes out of a module, which is strict: `arguments` does not follow the parameters, and `this` of a plain call is undefined.
    const asCommonJs = (code: string) =>
      '"use strict";\n' +
      code.replace(/^export (?=(?:async )?function|class |const |let )/gm, "") +
      exportsOfPart
        .map(name =>
          isMoved.get(name)?.kind === "variable"
            ? `Object.defineProperty(exports, "${name}", { get: () => ${name}, enumerable: true });\n`
            : `exports.${name} = ${name};\n`,
        )
        .join("");
    const typedText = [...importOf(needed), ...body, ""].join("\n");
    // The names that only the calls use are imported behind the erasure, which drops an import that nothing uses.
    const calledByName = callees.filter(
      name =>
        !needed.includes(name) &&
        calls.some(call => new RegExp(`(?<![\\w$])${name.replaceAll("$", "\\$")}[(.,]`).test(call)),
    );
    /** Comments that say the types of a function to the checker, which reads them in JavaScript. A type that names something of main is left out. */
    const withComments = (code: string) => {
      if (part.types !== "none" || !chance(45)) return code;
      const areWrong = chance(60);
      const known = (type: string) =>
        [...namesIn(type)].some(other => declared.has(other) || /^[A-Z]\w*$/.test(other)) ? "any" : type;
      for (const item of part.items) {
        if (item.kind !== "function") continue;
        const start = new RegExp(`^(?:async )?function\\*? ?${identifier}`).exec(
          item.text.at(-1)!.endsWith("}") && item.text.length > 1
            ? (item.text.find(line => line.endsWith("{")) ?? "")
            : item.text[0],
        );
        const header = item.text.find(line => line.endsWith("{")) ?? item.text[0];
        const signature = start && signatureAt(header, start[0].length);
        if (!signature || signature.generics) continue;
        const tags = signature.parameters
          .map((parameter, index) =>
            /^(\.\.\.)?([\w$]+)(\?)?: (.*)$/.exec(declaredParameter(parameter, index, () => "any")),
          )
          .filter(found => found !== null && found[2] !== "this")
          .map(
            found =>
              `@param {${found![1] ?? ""}${areWrong && chance(50) ? pick(primitives.slice(0, 4)) : known(found![4]).replace(/\[\]$/, found![1] ? "" : "[]")}} ${found![3] ? `[${found![2]}]` : found![2]}`,
          );
        const returns =
          areWrong && chance(60) ? pick([...primitives, ...otherTypes]) : known(signature.returns ?? "any");
        code = code.replace(
          new RegExp(`^(?=export (?:async )?function\\*? ?${item.name.replaceAll("$", "\\$")}\\()`, "m"),
          `/** ${[...tags, `@returns {${returns}}`].join(" ")} */\n`,
        );
        doubtful.add(item.name);
      }
      return code;
    };
    const javaScript = () =>
      [
        ...(calledByName.length ? [`import { ${calledByName.join(", ")} } from "${toMain}";`] : []),
        withComments(erased(typedText)) + calls.join("\n"),
        "",
      ].join("\n");
    /** What compilers to CommonJS make of `export { x } from` and `export * from`: a file whose names are those of another file. */
    const handedOnInCommonJs = (from: string) => {
      const mark = 'Object.defineProperty(exports, "__esModule", { value: true });';
      const getter = (other: string, inner: string) =>
        `Object.defineProperty(exports, "${other}", { enumerable: true, get: function () { return ${inner}.${other}; } });`;
      return [
        ...pick([
          () => [
            ...(chance(50) ? [mark] : []),
            `var inner_1 = require("${from}");`,
            ...exportsOfPart.map(other => getter(other, "inner_1")),
          ],
          () => [
            ...(chance(50) ? [mark] : []),
            `var inner_1 = require("${from}");`,
            ...exportsOfPart.map(other => getter(other, "inner_1")),
          ],
          // The getters stand above the `require`.
          () => [mark, ...exportsOfPart.map(other => getter(other, "_inner")), `const _inner = require("${from}");`],
          () => [
            ...(chance(50) ? [mark] : []),
            `var inner_1 = require("${from}");`,
            ...exportsOfPart.map(other => `exports.${other} = inner_1.${other};`),
          ],
          () => [
            "var __createBinding = function (o, m, k) { Object.defineProperty(o, k, { enumerable: true, get: function () { return m[k]; } }); };",
            'var __exportStar = function (m, exports) { for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p); };',
            mark,
            `__exportStar(require("${from}"), exports);`,
          ],
          () => [
            mark,
            `var _inner = require("${from}");`,
            "Object.keys(_inner).forEach(function (key) {",
            '    if (key === "default" || key === "__esModule") return;',
            "    if (key in exports && exports[key] === _inner[key]) return;",
            "    Object.defineProperty(exports, key, { enumerable: true, get: function () { return _inner[key]; } });",
            "});",
          ],
          () => [`module.exports = require("${from}");`],
          () => [`Object.assign(exports, require("${from}"));`],
          () => [`module.exports = { ...require("${from}") };`],
        ])(),
        "",
      ].join("\n");
    };
    const name = `part${number}-${hash}`;
    let hasGetters = false;
    const lay = (path: string, content: string) => files.push([`${folder}/${path}`, content]);
    switch (part.form) {
      case "ts": {
        part.specifier = `./${name}.ts`;
        if (!isTypeScript || isWrong) {
          // Annotations that the code doesn't fit, in a file that isn't checked.
          const wrong = body.map(line => {
            const found = new RegExp(`^export (?:async )?function\\*? ?${identifier}`).exec(line);
            const signature = found && signatureAt(line, found[0].length);
            if (!signature || !line.endsWith("{") || !chance(80)) return line;
            const parameters = signature.parameters.map(parameter =>
              /^[\w$]+$/.test(parameter)
                ? `${parameter}: ${pick(primitives.slice(0, 4))}`
                : chance(50)
                  ? parameter.replace(/: (?:number|string|boolean|any|unknown)\b/, `: ${pick(primitives.slice(0, 4))}`)
                  : parameter,
            );
            const returns = chance(50)
              ? `: ${pick(primitives.slice(0, 4))}`
              : signature.returns
                ? `: ${signature.returns}`
                : "";
            return `${found[0]}${signature.generics}(${parameters.join(", ")})${/^export (?:async|function\*)/.test(line) ? (signature.returns ? `: ${signature.returns}` : "") : returns} {`;
          });
          lay(`${name}.ts`, ["// @ts-nocheck", ...importOf(needed), ...wrong, ""].join("\n"));
          break;
        }
        // The part can have a declaration of its own for a type of main, under the same name, and that one can say something else.
        const copies: string[] = [];
        const copied = new Set<string>();
        let isChanged = false;
        for (const type of needed.filter(other => declared.get(other) === "type" && chance(35))) {
          const first = lines.findIndex(line => new RegExp(`^(?:interface|type) ${type}\\b`).test(line));
          const last =
            first < 0 || !lines[first].endsWith("{")
              ? first
              : lines.findIndex((line, index) => index > first && /^\}/.test(line));
          if (last < 0) continue;
          const declaration = lines.slice(first, last + 1).join("\n");
          const isThisChanged = chance(60);
          isChanged ||= isThisChanged;
          copies.push(isThisChanged ? changed(declaration) : declaration);
          copied.add(type);
        }
        const mentionedInCopies = namesIn(copies.join("\n"));
        const imported = [
          ...new Set([
            ...needed,
            ...[...declared.keys()].filter(
              other =>
                declared.get(other) !== "value" && declared.get(other) !== "function" && mentionedInCopies.has(other),
            ),
          ]),
        ].filter(other => !copied.has(other) && !inPart.has(other));
        for (const other of imported) (declared.get(other) === "type" ? exportedTypes : exportedValues).add(other);
        lay(
          `${name}.ts`,
          [...(isChanged ? ["// @ts-nocheck"] : []), ...importOf(imported), ...copies, ...body, ""].join("\n"),
        );
        break;
      }
      case "js":
      case "mjs":
      case "cjs": {
        part.specifier = `./${name}.${part.form}`;
        lay(`${name}.${part.form}`, part.form === "cjs" ? asCommonJs(javaScript()) : javaScript());
        if (part.types !== "none") lay(`${name}.d.${part.form.replace("js", "ts")}`, declarations());
        // Up to three files in a row that hand the names on.
        if (part.form === "cjs" && chance(isQuiet ? 85 : 50))
          for (let level = 1 + below(3); level > 0; level--) {
            const outer = `getters${level}of${number}-${hash}`;
            lay(`${outer}.cjs`, handedOnInCommonJs(part.specifier));
            if (part.types !== "none") lay(`${outer}.d.cts`, `export * from "${part.specifier}";\n`);
            part.specifier = `./${outer}.cjs`;
            hasGetters = true;
          }
        break;
      }
      default: {
        part.specifier = `package${number}-${hash}`;
        const root = `node_modules/${part.specifier}`;
        const isModule = hasAVariable || chance(50);
        const manifest: Record<string, unknown> = {
          name: part.specifier,
          version: "1.0.0",
          ...(isModule && { type: "module" }),
          // Whether a file of the package can be left out when nothing of it is used.
          ...(chance(isQuiet ? 90 : 30) && {
            sideEffects: pick([false, false, false, [], true, ["./index.js"], ["./nothing-of-that-name.js"]]),
          }),
        };
        if (part.form === "package of TypeScript") {
          const text =
            part.types === "wrong"
              ? typedText.replace(/\): (?:number|string|boolean|void) \{/, `): ${pick(primitives.slice(0, 3))} {`)
              : typedText;
          if (chance(65)) {
            const [module, moduleResolution] = pick([
              ["NodeNext", "NodeNext"],
              ["ESNext", "Bundler"],
              ["Preserve", "Bundler"],
            ]);
            // The files name each other by the ".js" that a compiler would make of them.
            const ending = pick([".js", ".js", ".ts", ...(module === "NodeNext" ? [] : [""])]);
            const [shape, mode, table, wanted] = ["Shape", "Mode", "table", "isWanted"].map(
              name => `${name}Of${number}`,
            );
            lay(
              `${root}/src/shapes.ts`,
              `export interface ${shape} { id: number; names: string[] }\nexport type ${mode} = "a" | "b";\nexport const ${table}: Record<${mode}, number> = { a: 1, b: 2 };\n`,
            );
            lay(`${root}/src/keys.ts`, "export function double(n: number): number { return n * 2; }\n");
            lay(
              `${root}/src/policy.ts`,
              `import type { ${shape} } from "./shapes${ending}";\nimport { double } from "./keys${ending}";\nconst seven = 7;\nexport function ${wanted}(shape: ${shape}): boolean { return shape.id === seven || shape.names.length === double(2); }\n`,
            );
            lay(`${root}/src/part.ts`, text);
            lay(
              `${root}/src/index.ts`,
              [
                `export type { ${shape}, ${mode} } from "./shapes${ending}";`,
                ...(chance(50) ? [`export { ${table} } from "./shapes${ending}";`] : []),
                `export { ${wanted} } from "./policy${ending}";`,
                chance(50)
                  ? `export * from "./part${ending}";`
                  : `export { ${exportsOfPart.join(", ")} } from "./part${ending}";`,
                "",
              ].join("\n"),
            );
            Object.assign(
              manifest,
              pick([
                { main: "./src/index.ts" },
                { main: "./src/index.ts", types: "./src/index.ts", exports: { ".": "./src/index.ts" } },
                { exports: { ".": { types: "./src/index.ts", default: "./src/index.ts" } } },
              ]),
            );
            const target = pick(["ES2020", "ES2022", "ESNext"]);
            lay(
              `${root}/tsconfig.json`,
              JSON.stringify(
                {
                  compilerOptions: {
                    target,
                    module,
                    moduleResolution,
                    ...(chance(40) && { lib: [target] }),
                    ...(chance(80) && { strict: chance(60) }),
                    ...(chance(20) && { strictNullChecks: chance(50) }),
                    ...(chance(15) && { exactOptionalPropertyTypes: true }),
                    ...(chance(15) && { noUncheckedIndexedAccess: true }),
                    // In a package that is CommonJS, that option refuses every `export`.
                    ...(isModule && chance(15) && { verbatimModuleSyntax: true }),
                    ...(chance(15) && { isolatedModules: true }),
                    ...(chance(15) && { useDefineForClassFields: chance(50) }),
                    ...(chance(10) && { experimentalDecorators: true }),
                    ...(ending === ".ts" && { allowImportingTsExtensions: true, noEmit: true }),
                    ...(chance(50) && { types: [] }),
                  },
                  ...(chance(60) && { include: ["src/**/*"] }),
                },
                null,
                2,
              ) + "\n",
            );
            importsOfMain.push(`import { ${wanted} } from "${part.specifier}";`);
            endOfMain.push(
              `printValue("asked of package ${number}", ${wanted}({ id: 7, names: [] }), ${wanted}({ id: 1, names: ["x"] }));`,
            );
          } else {
            manifest.main = "./index.ts";
            lay(`${root}/index.ts`, text);
          }
        } else {
          if (!isModule && calledByName.length === 0 && chance(60)) {
            lay(`${root}/lib/inner.js`, asCommonJs(javaScript()));
            lay(`${root}/index.js`, handedOnInCommonJs("./lib/inner.js"));
            hasGetters = true;
          } else lay(`${root}/index.js`, isModule ? javaScript() : asCommonJs(javaScript()));
          const hasTypes = part.types !== "none";
          if (hasTypes) lay(`${root}/index.d.ts`, declarations());
          if (part.form === "package with typed source") {
            lay(`${root}/index.aot.ts`, typedText);
            manifest.exports = {
              ".": { aot: "./index.aot.ts", ...(hasTypes && { types: "./index.d.ts" }), default: "./index.js" },
            };
          } else if (chance(50))
            manifest.exports = { ".": { ...(hasTypes && { types: "./index.d.ts" }), default: "./index.js" } };
          else Object.assign(manifest, { main: "./index.js" }, hasTypes && { types: "./index.d.ts" });
        }
        lay(`${root}/package.json`, JSON.stringify(manifest, null, 2) + "\n");
      }
    }
    // Between main and the part can stand a file that hands the names on.
    let from = part.specifier;
    if (!isTypeScript && chance(hasGetters ? (isQuiet ? 90 : 70) : 20)) {
      const between = `between${number}-${hash}.mjs`;
      lay(
        between,
        (chance(70) ? `export * from "${from}";` : `export { ${exportsOfPart.join(", ")} } from "${from}";`) + "\n",
      );
      from = `./${between}`;
    }
    if (isTypeScript && chance(hasGetters ? (isQuiet ? 90 : 70) : 25)) {
      const between = `between${number}-${hash}.ts`;
      const ignore = isWrong || part.types === "none" ? ["// @ts-ignore"] : [];
      // A function of its own around each function of the part, with the types that the part is said to have.
      const wrapped = chance(40)
        ? part.items
            .filter(
              item =>
                item.kind === "function" &&
                /^function [a-z]/.test(
                  item.text.at(-1)!.endsWith(";") ? "" : (item.text.find(line => !line.endsWith(";")) ?? ""),
                ),
            )
            .map(item => item.name)
        : [];
      const handedOn = exportsOfPart.filter(other => !wrapped.includes(other));
      lay(
        between,
        (wrapped.length
          ? [
              ...ignore,
              `import { ${wrapped.map(other => `${other} as ${other}OfThePart`).join(", ")} } from "${from}";`,
              ...wrapped.map(
                other =>
                  `export function ${other}(this: unknown, ...given: Parameters<typeof ${other}OfThePart>): ReturnType<typeof ${other}OfThePart> { return ${other}OfThePart.apply(this, given); }`,
              ),
              ...(handedOn.length ? [...ignore, `export { ${handedOn.join(", ")} } from "${from}";`] : []),
            ]
          : chance(50)
            ? [`export * from "${from}";`]
            : [...ignore, `export { ${exportsOfPart.join(", ")} } from "${from}";`]
        ).join("\n") + "\n",
      );
      from = `./${between}`;
      for (const other of wrapped) doubtful.add(other);
    }
    // A part that imports nothing of main can be loaded while main runs. A class is also a type, which a constant isn't.
    const canBeConstants =
      isClosed &&
      calledByName.length === 0 &&
      part.items.every(item => item.kind !== "variable") &&
      (!isTypeScript || part.items.every(item => item.kind !== "class" || item.throughAFunction));
    const names = `{ ${exportsOfPart.join(", ")} }`;
    const isCommonJs = part.form === "cjs";
    importsOfMain.push(
      canBeConstants && chance(35)
        ? pick([
            `import * as part${number} from "${from}";\nconst ${names} = part${number};`,
            `const ${names} = await import("${from}");`,
            ...(isCommonJs && from === part.specifier
              ? [
                  `const ${names} = require("${from}")${isTypeScript ? ` as typeof import("${from}")` : ""};`,
                  `const ${names} = require("${from}");`,
                ]
              : []),
          ])
        : `import ${names} from "${from}";`,
    );
    if (part.types !== "right" || part.form === "ts") for (const name of exportsOfPart) doubtful.add(name);
    for (const item of part.items) if (item.throughAFunction) doubtful.add(item.name);
  });

  // Main without what moved.
  const isUnchecked = lines[0] === "// @ts-nocheck";
  // How main gets past the checker where a declaration is wrong: a comment above each line that names the part's, one comment for the file, or nothing.
  const suppression =
    !isTypeScript || isUnchecked
      ? "nothing"
      : pick(["each line", "each line", "each line", "the file", "nothing"] as const);
  const comment = () => (chance(70) ? "// @ts-ignore" : "// @ts-expect-error");
  const namesDoubtful = doubtful.size
    ? new RegExp(`(?<![.\\w$])(?:${[...doubtful].map(name => name.replaceAll("$", "\\$")).join("|")})\\b`)
    : /(?!)/;
  const rest: string[] = [];
  lines.forEach((line, index) => {
    const item = moved.find(item => index >= item.first && index <= item.last);
    if (item && !(item.throughAFunction && index === item.first)) return;
    const written = item
      ? [
          `const ${item.name} = make${item.name}();`,
          ...(isTypeScript ? [`type ${item.name} = InstanceType<typeof ${item.name}>;`] : []),
        ]
      : [line];
    for (const one of written) {
      if (suppression === "each line" && namesDoubtful.test(one) && !/^\s*\/\/ @ts-/.test(rest.at(-1) ?? ""))
        rest.push(/^\s*/.exec(one)![0] + comment());
      rest.push(one);
    }
  });
  const exportsNothing = rest.lastIndexOf("export {};");
  if (exportsNothing >= 0) rest.splice(exportsNothing, 1);
  const stillThere = (name: string) => declared.has(name) || isMoved.has(name);
  const head = [
    ...(suppression === "the file" ? ["// @ts-nocheck"] : []),
    ...importsOfMain.flatMap(line => (suppression === "each line" ? [comment(), line] : [line])),
  ];
  if (isUnchecked) head.unshift(rest.shift()!);
  const values = [...exportedValues].filter(stillThere);
  const mainText = [
    ...head,
    ...rest,
    ...endOfMain.flatMap(line => (suppression === "each line" ? [comment(), line] : [line])),
    ...(values.length ? [`export { ${values.join(", ")} };`] : []),
    ...(exportedTypes.size ? [`export type { ${[...exportedTypes].join(", ")} };`] : []),
    "export {};",
    "",
  ].join("\n");

  // A manifest for the folder. Main is imported for what it does, so it is listed: every other file can be left out when nothing of it is used.
  if (isQuiet)
    files.push([
      `${folder}/package.json`,
      JSON.stringify(
        { name: `split-${hash}`, sideEffects: chance(70) ? [`./${main}`] : [`./${main}`, "./part1-*"] },
        null,
        2,
      ) + "\n",
    ]);
  // The options that decide what the checker reads and reports.
  if (chance(70)) {
    const drawn = (name: string, percentOfTrue: number) => (chance(30) ? {} : { [name]: chance(percentOfTrue) });
    const compilerOptions = {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
      allowImportingTsExtensions: true,
      ...drawn("strict", 25),
      ...drawn("skipLibCheck", 60),
      ...drawn("allowJs", 60),
      ...drawn("checkJs", 40),
      ...(chance(15) ? { noImplicitAny: chance(50) } : {}),
      ...(chance(10) ? { strictNullChecks: chance(50) } : {}),
      ...(chance(10) ? { exactOptionalPropertyTypes: true } : {}),
      ...(chance(10) ? { noUncheckedIndexedAccess: true } : {}),
      ...(chance(10) ? { isolatedModules: true } : {}),
      ...(chance(10) ? { maxNodeModuleJsDepth: below(3) } : {}),
    };
    files.push([`${folder}/tsconfig.json`, JSON.stringify({ compilerOptions }, null, 2) + "\n"]);
  }
  const moveIntoFolder = (file: string) => file.replace(/^\/\/ @filename: \.\//, `// @filename: ${folder}/`);
  return [
    `import "${folder}/${main}";\nexport {};\n`,
    `// @filename: ${folder}/${main}\n${mainText}`,
    ...files.map(([path, content]) => `// @filename: ${path}\n${content}`),
    ...furniture.map(moveIntoFolder),
  ].join("");
}
