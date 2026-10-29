// The registry of sources. A source turns a seed into a program for a runner, or into nothing if that seed has no
// program.
//
// A source's name is the name of its file, and the comment at the top of that file says what its programs test. The
// general-purpose ones:
//
//   mutation          a stored program from ../parallel with something done to it (mutate.ts)
//   grammar           a random program built from a pool of language features (grammar.ts)
//   stored-programs   the stored programs unchanged, for runs that vary how a program is built
//
// Every source also exists in two variants:
//
//   <source>-multi-file   the same program with its top-level declarations moved into up to four more files that import each other
//                         (declarations-split-into-files.ts). Some files become JavaScript, some get incomplete or invalid declaration files, some
//                         become packages in node_modules, some are imported through a barrel file
//   <source>-rewritten    the same program transformed so that it prints the same and the compiler knows less about it (see asRewritten below)
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { withPackedPrograms } from "../generate";
import { printFor, projects, scriptMarker, type Runner, type Program } from "./runners";
import { withGcInsideCalls } from "./gc-inside-calls";
import { splitDeclarationsIntoFiles } from "./declarations-split-into-files";
import { table, whole, type Drawn } from "./family";
import { withFunctionsTheHostCouldCall } from "./host-callable-functions";
import { erased, mutate, reprinted } from "./mutate";
import { Random } from "./random";
import { places, wrapFileInFunction } from "./wrap-file-in-function";
import { withTheWorldOpen } from "./open-world-global-access";
import { hideLoopTripCounts } from "./hide-loop-trip-counts";

export interface Generated extends Program {
  source: string;
  seed: number;
  /** Where it comes from and what was done to it. */
  notes: string;
  /** The program a mutant was made from: if that one already differs, the mutant means nothing. */
  base?: Program & { name: string };
  /** What the program tests. Two programs of different groups that fail with the same message are two findings. */
  group?: string;
  /**
   * Its cases, each as a separate program that prints the same lines as in the whole program: a finding is first
   * narrowed down to one of them.
   */
  alone?: string[];
  /** TypeScript's own checker must accept it, or it does not count. */
  isForTypeScript?: true;
  /** It must be the entry point of its build, never a module of a shared build. */
  needsOwnBuild?: true;
  /** The single-file text that was split into its files: a finding is tried on that first. */
  singleFileText?: string;
}

export type Source = (seed: number, runner: Runner) => Generated | undefined;

export const multiFileSuffix = "-multi-file";
export const rewrittenSuffix = "-rewritten";

// At the top level of a file with an `import`, `this` is null in plain Bun and undefined in an executable; without one
// it is an object in both. The transpiler knows which `this` is at the top level: in a module it prints null instead.
function usesTopLevelThis(text: string, extension: "js" | "ts"): boolean {
  const printer = new Bun.Transpiler({ loader: extension });
  const count = (printed: string) => printed.match(/\bthis\b/g)?.length ?? 0;
  try {
    return (
      count(printer.transformSync(`async function all() {\n${text}\n}`)) >
      count(printer.transformSync(`export {};\n${text}`))
    );
  } catch {
    return false;
  }
}

/**
 * The end of what begins at `from`: the matching closing bracket or, for a type, the position before the `{` of a body
 * or the `=` of an initializer. -1 if there is none.
 */
function endOf(text: string, from: number, what: "bracket" | "{" | "="): number {
  let depth = 0;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'" || char === "`") {
      at = text.indexOf(char, at + 1);
      if (at < 0) return -1;
    } else if (char === "=" && text[at + 1] === ">") at++;
    else if (depth === 0 && char === what) {
      const before = text.slice(from, at).trimEnd();
      // `{` may also begin a type: at the start, and after anything that expects a type.
      if (
        what === "=" ||
        (before && !/(?:[|&:,<([]|=>|\b(?:is|extends|keyof|typeof|readonly|asserts|infer|new))$/.test(before))
      )
        return at;
      depth++;
    } else if ("([{<".includes(char)) depth++;
    else if (")]}>".includes(char) && --depth === 0 && what === "bracket") return at;
  }
  return -1;
}

/** A narrower type than the given one, so that any consumer of the given type accepts it. Nothing if no rule fits. */
function narrower(type: string, random: Random): string | undefined {
  const members: string[] = [];
  let from = 0;
  for (let at = 0, depth = 0; at <= type.length; at++) {
    if (at === type.length || (depth === 0 && type[at] === "|"))
      (members.push(type.slice(from, at).trim()), (from = at + 1));
    else if (type[at] === "=" && type[at + 1] === ">") return;
    else if ("([{<".includes(type[at])) depth++;
    else if (")]}>".includes(type[at])) depth--;
  }
  if (members.length > 1) return random.pick(members.filter(Boolean));
  const inPromise = /^Promise<(.+)>$/.exec(type);
  if (inPromise) {
    const inner = narrower(inPromise[1], random);
    return inner && `Promise<${inner}>`;
  }
  const rules: Record<string, string[]> = {
    number: ["1", "0"],
    string: ['"text"', '""'],
    boolean: ["true", "false"],
    unknown: ["number", "string", "{ a: number }", "number[]", "null"],
    any: ["number", "string", "{ a: number }", "number[]", "undefined"],
    object: ["{ a: number }", "number[]"],
    "unknown[]": ["number[]", "string[]", "[number]"],
    "any[]": ["number[]", "string[]", "[number]"],
    "number[]": ["[number]", "1[]", "[]"],
    "string[]": ["[string]", '"text"[]', "[]"],
  };
  return rules[type] && random.pick(rules[type]);
}

/**
 * A declaration file for the text in which one to three functions and constants declare a narrower type than they
 * return. Nothing if the text has a form this does not handle, or nothing to narrow.
 */
function incompleteDeclarations(typed: string, random: Random): string | undefined {
  const declared: { text: string; type?: [from: number, to: number] }[] = [];
  for (const unit of typed.split(/\n(?=[^\s})\]])/)) {
    if (/^(?:import|export (?:interface|type))\b/.test(unit)) declared.push({ text: unit.trimEnd() });
    else if (!unit.startsWith("export ")) continue;
    else if (/^export (?:async )?function\b/.test(unit)) {
      const head = /^export (async )?function(\*)? ?[\w$]+/.exec(unit)!;
      const open = unit[head[0].length] === "<" ? endOf(unit, head[0].length, "bracket") + 1 : head[0].length;
      const close = unit[open] === "(" ? endOf(unit, open, "bracket") : -1;
      // A declaration has no defaults, a pattern carries no information there, and of several signatures the last one
      // is not declared.
      if (
        close < 0 ||
        /=(?!>)|(?:^|,)\s*(?:\.\.\.)?[{[]/.test(unit.slice(open + 1, close)) ||
        !unit.startsWith(": ", close + 1)
      )
        return;
      const end = endOf(unit, close + 3, "{");
      if (end < 0 || /\n/.test(unit.slice(0, end))) return;
      // A declaration has no `*`: the type says everything.
      const text = `export declare function ${unit.slice(`export ${head[1] ?? ""}function${head[2] ?? ""}`.length, end).trim()};`;
      declared.push({
        text,
        ...(head[2] ? {} : { type: [text.length - 1 - unit.slice(close + 3, end).trimEnd().length, text.length - 1] }),
      });
    } else if (/^export const [\w$]+: /.test(unit)) {
      const from = unit.indexOf(": ") + 2;
      const end = endOf(unit, from, "=");
      if (end < 0) return;
      const text = `export declare const ${unit.slice("export const ".length, end).trimEnd()};`;
      declared.push({ text, type: [text.length - 1 - unit.slice(from, end).trimEnd().length, text.length - 1] });
    } else if (/^export const [\w$]+ = /.test(unit))
      declared.push({ text: `export declare const ${/[\w$]+/.exec(unit.slice(13))![0]}: any;` });
    else if (/^export class [\w$]+ /.test(unit))
      declared.push({
        text: `export declare class ${/[\w$]+/.exec(unit.slice(13))![0]} {\n  constructor(...all: any[]);\n  [member: string]: any;\n  static [member: string]: any;\n}`,
      });
    else return;
  }
  let said = 0;
  for (const each of random.shuffled(declared)) {
    const less = each.type && said < 3 && narrower(each.text.slice(...each.type), random);
    if (!less) continue;
    each.text = each.text.slice(0, each.type![0]) + less + each.text.slice(each.type![1]);
    said++;
  }
  return said ? declared.map(each => each.text + "\n").join("") : undefined;
}

/**
 * Turns some of the files into JavaScript with their types erased: what the other files know about them is inferred, or
 * comes from an incomplete declaration file. A file is left alone if another file imports a type from it, or if it
 * declares something JavaScript cannot express.
 */
/**
 * Makes the TypeScript itself incomplete: one to three exported functions and constants are annotated with a narrower
 * type than they return, and `// @ts-nocheck` at the top silences the checker. Nothing if there is nothing to narrow.
 */
function withIncompleteAnnotations(typed: string, random: Random): string | undefined {
  const places: [from: number, to: number][] = [];
  for (const { 0: head, index } of typed.matchAll(/^export (?:(?:async )?function [\w$]+|const [\w$]+: )/gm)) {
    const behind = index + head.length;
    if (head.endsWith(": ")) places.push([behind, endOf(typed, behind, "=")]);
    else {
      const open = typed[behind] === "<" ? endOf(typed, behind, "bracket") + 1 : behind;
      const close = typed[open] === "(" ? endOf(typed, open, "bracket") : -1;
      if (close > 0 && typed.startsWith(": ", close + 1)) places.push([close + 3, endOf(typed, close + 3, "{")]);
    }
  }
  let changed = typed;
  let said = 0;
  // From the last to the first, so that earlier offsets stay valid.
  for (const [from, to] of random
    .sample(
      places.filter(([, to]) => to > 0),
      3,
    )
    .sort((a, b) => b[0] - a[0])) {
    const less = narrower(typed.slice(from, to).trim(), random);
    if (!less) continue;
    changed = `${changed.slice(0, from)}${less} ${changed.slice(to)}`;
    said++;
  }
  return said ? "// @ts-nocheck\n" + changed : undefined;
}

// Errors that a checker reports only inside a declaration file. With `skipLibCheck` nobody sees them.
const invalidDeclarations: readonly string[] = [
  "export declare const invalidName: Missing;",
  "export declare function invalidResult(value: number): Absent<string>;",
  "export declare const invalidArguments: Date<string>;",
  "export declare const declaredTwice: number;\nexport declare const declaredTwice: string;",
  "export declare class InvalidHeir extends NotDeclared {}",
  "export interface InvalidInterface extends Missing {}",
  "export type InvalidRing = InvalidRing;",
  "export declare function invalidParameter(value: Missing.Inner): void;",
  "export declare const invalidQuery: typeof notDeclared;",
  "export declare let invalidMember: Array<number>.absent;".replace(".absent", '["absent"]'),
];

/** The declarations plus one to three invalid ones, and sometimes a result of an undeclared type. */
function withInvalidDeclarations(declarations: string, random: Random): string {
  const unknown = random.chance(0.5)
    ? declarations.replace(/^(export declare function [^\n]*\): )[^\n]*;$/m, "$1Missing;")
    : declarations;
  return unknown + random.sample(invalidDeclarations, random.between(1, 3)).map(each => each + "\n").join(""); // prettier-ignore
}

function withSomeFilesInJavaScript(
  text: string,
  files: Record<string, string>,
  random: Random,
): Record<string, string> {
  const all = [text, ...Object.values(files)].join("\n");
  let isInvalid = false;
  const changed = Object.fromEntries(
    Object.entries(files).flatMap(([path, typed]) => {
      const stem = path.replace(/\.ts$/, "");
      const isAsked = random.chance(0.5);
      if (!isAsked || new RegExp(`^import type [^;]*"\\./${stem}"`, "m").test(all)) return [[path, typed]];
      if (/\b(enum|namespace|module|declare|abstract)\b/.test(typed)) return [[path, typed]];
      try {
        const untyped = erased(typed, "ts");
        if (untyped.includes('from "bun:wrap"')) return [[path, typed]];
        const declarations = random.chance(0.5) ? incompleteDeclarations(typed, random) : undefined;
        if (!declarations) return [[stem + ".js", untyped]];
        if (!random.chance(0.4)) return [[stem + ".js", untyped], [stem + ".d.ts", declarations]]; // prettier-ignore
        isInvalid = true;
        return [[stem + ".js", untyped], [stem + ".d.ts", withInvalidDeclarations(declarations, random)]]; // prettier-ignore
      } catch {
        return [[path, typed]];
      }
    }),
  );
  // The program then gets its own tsconfig.json, with which declaration files are not checked.
  const own = { compilerOptions: { ...projects["default"].tsconfig!.compilerOptions, skipLibCheck: true } };
  return isInvalid ? { ...changed, "tsconfig.json": JSON.stringify(own) + "\n" } : changed;
}

/**
 * Makes the entry point import through one more file that only re-exports what the others export, with `export *` or
 * name by name. Unchanged if the entry point imports nothing from them.
 */
function viaBarrel(text: string, extension: string, random: Random): { text: string; barrel?: string } {
  const handedOn: string[] = [];
  const end = extension === "ts" ? "" : `.${extension}`;
  const changed = text.replace(
    /^import (type )?\{ ([^}]*) \} from ("\.\/declared-\d+(?:\.\w+)?");$/gm,
    (_, type: string | undefined, names: string, from: string) => {
      const star = `export * from ${from};`;
      if (!handedOn.includes(star))
        handedOn.push(random.chance(0.5) ? star : `export ${type ?? ""}{ ${names} } from ${from};`);
      return `import ${type ?? ""}{ ${names} } from "./barrel${end}";`;
    },
  );
  return handedOn.length ? { text: changed, barrel: handedOn.map(line => line + "\n").join("") } : { text };
}

/**
 * An ES module, printed one statement per line, converted to the CommonJS that compilers emit: functions are assigned
 * to `exports` at the top, the rest at the end. Nothing if a form remains that has no such translation.
 */
function asCommonJS(text: string): string | undefined {
  const functions: string[] = [];
  const names = new Bun.Transpiler({ loader: "js" }).scan(text).exports;
  const body = text
    .replace(
      /^import \{ ([^}]*) \} from ("[^"]*");$/gm,
      (_, taken: string, from: string) => `const { ${taken.replaceAll(" as ", ": ")} } = require(${from});`,
    )
    .replace(
      /^export ((?:async )?function\*? ?([\w$]+))/gm,
      (_, head: string, name: string) => (functions.push(name), head),
    )
    .replace(/^export (?=(?:class|const|let|var) )/gm, "");
  if (/^(?:import|export)\b|\bimport\.meta\b|^await\b|\bfor await\b/m.test(body) || names.includes("default")) return;
  const laidOn = (name: string) => `exports.${name} = ${name};\n`;
  return `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n${functions.map(laidOn).join("")}${body}${body.endsWith("\n") ? "" : "\n"}${names.filter(name => !functions.includes(name)).map(laidOn).join("")}`; // prettier-ignore
}

/**
 * Turns some of the JavaScript files that have declarations into packages: `node_modules/declared-<n>` with a
 * package.json, imported by name. A file only moves if everything it imports has moved.
 */
function withSomeFilesAsPackages(
  text: string,
  files: Record<string, string>,
  random: Random,
): { text: string; files: Record<string, string>; packages: number } {
  const moved: string[] = [];
  for (const path of Object.keys(files)) {
    const stem = /^(declared-\d+)\.js$/.exec(path)?.[1];
    if (!stem || !files[`${stem}.d.ts`] || !random.chance(0.6)) continue;
    const imported = [files[path], files[`${stem}.d.ts`]].flatMap(each => Array.from(each.matchAll(/from "\.\/([\w-]+)(?:\.\w+)?"/g), match => match[1])); // prettier-ignore
    if (imported.every(name => moved.includes(name))) moved.push(stem);
  }
  const byName = (each: string) => each.replace(/(from )"\.\/([\w-]+)(?:\.\w+)?"/g, (whole, from: string, name: string) => (moved.includes(name) ? `${from}"${name}"` : whole)); // prettier-ignore
  const laid: Record<string, string> = {};
  for (const [path, each] of Object.entries(files)) {
    const [, stem, end] = /^(declared-\d+)(\.js|\.d\.ts)$/.exec(path) ?? [];
    laid[moved.includes(stem) ? `node_modules/${stem}/index${end}` : path] = /\.[jt]s$/.test(path)
      ? byName(each)
      : each;
  }
  // Two packages with the same name and version count as one package, and a build may hold many programs.
  for (const name of moved) {
    const index = `node_modules/${name}/index.js`;
    const required = random.chance(0.5) ? asCommonJS(laid[index]) : undefined;
    if (required) laid[index] = required;
    laid[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: `1.0.${Bun.hash.crc32(laid[index])}`, type: required ? "commonjs" : "module", main: "index.js", types: "index.d.ts" }) + "\n"; // prettier-ignore
  }
  return { text: byName(text), files: laid, packages: moved.length };
}

/**
 * A single-file program split into several files in all the ways above; `notes` says which. Nothing if it declares too
 * little at its top level, or reads `this` there.
 */
export function splitIntoFiles(
  text: string,
  extension: string,
  random: Random,
): { text: string; files: Record<string, string>; notes: string } | undefined {
  const isTyped = extension === "ts";
  if (usesTopLevelThis(text, isTyped ? "ts" : "js")) return;
  const laid = splitDeclarationsIntoFiles(text, extension, random, random.chance(0.5));
  if (!laid) return;
  const files = isTyped && random.chance(0.5) ? withSomeFilesInJavaScript(laid.text, laid.files, random) : laid.files;
  const { text: first, barrel } = random.chance(0.3) ? viaBarrel(laid.text, extension, random) : { text: laid.text };
  if (barrel) files[`barrel.${extension}`] = barrel;
  const { text: entry, files: all, packages } = withSomeFilesAsPackages(first, files, random);
  let unchecked = 0;
  for (const path of isTyped ? Object.keys(all) : []) {
    const lying =
      /^declared-\d+\.ts$/.test(path) && random.chance(0.25) && withIncompleteAnnotations(all[path], random);
    if (lying) (unchecked++, (all[path] = lying));
  }
  const untyped = isTyped ? Object.keys(files).filter(path => path.endsWith(".js")).length : 0;
  const declared = Object.keys(files).filter(path => path.endsWith(".d.ts")).length;
  const isUnchecked = "tsconfig.json" in files;
  return {
    text: entry,
    files: all,
    notes: `${Object.keys(files).length + 1 - declared - Number(isUnchecked)} files${untyped ? `, ${untyped} in JavaScript` : ""}${declared ? `, ${declared} of them beside declarations that say too little${isUnchecked ? " and are not valid, under skipLibCheck" : ""}` : ""}${barrel ? ", one a barrel" : ""}${packages ? `, ${packages} as packages` : ""}${unchecked ? `, ${unchecked} with annotations that say too little, under @ts-nocheck` : ""}`,
  };
}

/** The multi-file variant of a source. */
const asMultiFile =
  (source: Source): Source =>
  (seed, runner) => {
    if (!runner.supportsMultiFile) return;
    const whole = source(seed, runner);
    if (!whole || whole.files) return;
    // `print` is a declaration like the others: one file declares it and the rest import it.
    const hasNoPrint = /\bprint\(/.test(whole.text) && !/\b(function|const|let|var) print\b/.test(whole.text);
    const text = hasNoPrint ? printFor(whole.extension === "ts") + whole.text : whole.text;
    // Many sources use the lowest bit of the seed for "typed".
    const laid = splitIntoFiles(text, whole.extension, new Random(new Random(seed).next() ^ 0x2f11e5));
    if (!laid) return;
    const { alone, ...rest } = whole;
    return {
      ...rest,
      text: laid.text,
      files: laid.files,
      source: whole.source + multiFileSuffix,
      singleFileText: text,
      notes: `${whole.notes} | ${laid.notes}`,
    };
  };

/**
 * The rewritten variant of a source: each program is transformed in one to six ways that keep its output and hide
 * information from the compiler: its values are laundered through eval, the bounds of its short loops are only known at
 * run time, each function starts with a call that sometimes collects, the host could call what it declares, it uses
 * open-world global access, and the whole file is wrapped in a function, a try or a loop.
 */
const asRewritten =
  (source: Source): Source =>
  (seed, runner) => {
    if (runner.name !== "product") return;
    const whole = source(seed, runner);
    if (!whole || whole.files || (whole.extension !== "ts" && whole.extension !== "js")) return;
    const loader = whole.extension;
    const random = new Random(new Random(seed).next() ^ 0x51ab07);
    const place = places[random.between(0, places.length - 1)];
    // This parses the program with the TypeScript package, which is only loaded when this variant is used.
    const { laundered, whatIsLaundered } =
      require("./launder-values-through-dynamic-code") as typeof import("./launder-values-through-dynamic-code");
    const what = whatIsLaundered[random.between(0, whatIsLaundered.length - 1)];
    const ways: [name: string, write: (text: string) => string][] = [
      [`${what} come back from text nobody knows`, text => laundered(`main.${loader}`, text, what, random) ?? text],
      ["turns nobody knows", hideLoopTripCounts],
      ["collections inside calls", text => withGcInsideCalls(text, loader)],
      ["functions the host could call", text => withFunctionsTheHostCouldCall(text, loader)],
      ["the world is open", withTheWorldOpen],
      [`the whole file inside ${place}`, text => wrapFileInFunction(text, loader, place)],
    ];
    let text = whole.text;
    const taken: string[] = [];
    for (const [name, write] of ways) {
      if (!random.chance(0.4)) continue;
      const written = write(text);
      if (written !== text) taken.push(name);
      text = written;
    }
    if (!taken.length) return;
    const { alone, ...rest } = whole;
    return {
      ...rest,
      text,
      source: whole.source + rewrittenSuffix,
      notes: `${whole.notes} | ${taken.join(", ")}`,
      // Open-world access affects everything built together.
      needsOwnBuild: true,
    };
  };

/** The stored single-file programs that print the same compiled and plain and have no files stored beside them. */
function singleFilePrograms(root: string) {
  const found: string[] = [];
  const stored = [".json", ".expected.txt", ".erased.txt", ".build-errors.txt", ".todo.txt"];
  const visit = (folder: string) => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (entries.some(entry => entry.isFile() && entry.name.startsWith("main."))) return;
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      if (entry.isDirectory()) entry.name === "ways-into-library-modules" || visit(join(folder, entry.name));
      else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const stem = entry.name.replace(/\.\w+$/, "");
        if (!stored.some(suffix => names.has(stem + suffix))) found.push(join(folder, entry.name));
      }
    }
  };
  if (existsSync(root)) visit(root);
  return withPackedPrograms(root, found, /(?<!\.d)\.(ts|js)$/, stored);
}

// Depends on the file's location, the clock or chance, prints something that differs by design (positions, source
// text), or has its expected output stored at its end because it differs from plain Bun on purpose.
const differsByDesign =
  /from "\.|require\("\.|import\("\.|import\.meta|__dirname|__filename|process\.argv|\bprocess\b.*\bconsole\.log\(process\)|Bun\.main|\.stack\b|Date\.now|performance\.now|Math\.random|new Date\(\)|\.toString\(\)\.length|\.caller\b|getBuiltinModule|mkdtemp|hrtime|[cC]puUsage|memoryUsage|resourceUsage|randomUUID|randomBytes|getRandomValues|port: 0|listen\(0|\n\/\* (Output|Build errors):/;

function mutation(root: string, rejected: Set<string>): Source | undefined {
  const { paths: files, textOf } = singleFilePrograms(root);
  if (!files.length) return;
  const printed = new Map<string, string | undefined>();
  // The program as it is (typed), or with types erased and printed one statement per line.
  const baseText = (path: string, typed: boolean) => {
    const key = `${path} ${typed}`;
    if (printed.has(key)) return printed.get(key);
    let text: string | undefined = textOf(path);
    if (text.length > 12_000 || differsByDesign.test(text)) text = undefined;
    try {
      if (text !== undefined && !typed) text = erased(text, path.endsWith(".ts") ? "ts" : "js");
      // The transpiler lowers some syntax to helpers from Bun's own runtime module, which no program imports by hand.
      if (text?.includes('from "bun:wrap"')) text = undefined;
    } catch {
      text = undefined;
    }
    printed.set(key, text);
    return text;
  };
  return (seed, runner) => {
    const random = new Random(seed);
    for (let attempt = 0; attempt < 40; attempt++) {
      const path = random.pick(files);
      const typed = path.endsWith(".ts") && runner.name === "product" && random.chance(0.5);
      const name = `${runner.name} ${relative(root, path)}${typed ? "" : " erased"}`;
      if (rejected.has(name)) continue;
      const base = baseText(path, typed);
      const extension = typed ? "ts" : "js";
      if (base === undefined || !runner.accepts({ text: base, extension })) {
        rejected.add(name);
        continue;
      }
      const mutant = mutate(base, random, typed, { allows: text => runner.allows(text) });
      if (mutant)
        return {
          source: "mutation",
          seed,
          text: typed ? mutant.text : reprinted(mutant.text),
          extension,
          notes: `${name}: ${mutant.applied.join(", ")}`,
          base: { name, text: base, extension },
        };
    }
  };
}

function storedPrograms(
  root: string,
  source: string,
  pick: (seed: number, count: number) => number,
): Source | undefined {
  const { paths: files, textOf } = singleFilePrograms(root);
  if (!files.length) return;
  return (seed, runner) => {
    if (runner.name !== "product") return;
    const path = files[pick(seed, files.length)];
    const text = textOf(path);
    if (text.length > 60_000 || differsByDesign.test(text)) return;
    return {
      source,
      seed,
      text: path.endsWith(".js") && !/^(import|export)\b/m.test(text) ? scriptMarker + text : text,
      extension: path.endsWith(".ts") ? "ts" : "js",
      notes: relative(root, path),
    };
  };
}

function allocationUsePairs(): Source | undefined {
  const folder = join(import.meta.dir, "generators", "allocations-and-uses");
  if (!existsSync(folder)) return;
  const names = readdirSync(folder)
    .filter(
      name =>
        name.endsWith(".ts") &&
        !["run.ts", "with-types-erased.ts", "code-block-placement.ts"].includes(name) &&
        !(process.env.AOT_FUZZ_BIRTHS_WITHOUT ?? "").split(",").includes(name),
    )
    .sort();
  const differs = new Set(
    Object.values(
      JSON.parse(readFileSync(join(folder, "known-to-differ.json"), "utf8")) as Record<string, Record<string, string>>,
    ).flatMap(Object.keys),
  );
  const tables = new Map<string, { name: string; file: string; text: string; flags?: string[] }[]>();
  return (seed, runner) => {
    if (runner.name !== "product") return;
    const from = names[seed % names.length];
    const typed = Math.floor(seed / names.length) % 2 === 1;
    const key = from + typed;
    if (!tables.has(key)) tables.set(key, require(join(folder, from)).programs(typed));
    const table = tables.get(key)!;
    if (!table.length) return;
    // Neighbors in a table differ in one axis, so a stride coprime with most lengths spreads a batch over the table.
    const { name, file, text, flags } = table[(Math.floor(seed / (names.length * 2)) * 7919) % table.length];
    if (flags?.length || differs.has(name) || text.length > 60_000) return;
    const program: Program = { text, extension: file.endsWith(".ts") ? "ts" : "js" };
    return runner.accepts(program) && runner.allows(text)
      ? { source: "allocation-use-pairs", seed, ...program, notes: `${from} ${name}`, group: from }
      : undefined;
  };
}

type Generator = (random: Random, typed: boolean, profile: { library: boolean }) => string;

// A generator module is loaded when its first program is requested: a run that uses a few sources loads only those.
const generateOf =
  (name: string) =>
  (...given: unknown[]) =>
    require(`./${name}.ts`).generate(...given);
const tableOf = (name: string) => ({
  get programs(): number {
    return require(`./${name}.ts`).programs;
  },
  programOf: (index: number) => require(`./${name}.ts`).programOf(index),
  flagsOf: (index: number) => require(`./${name}.ts`).flagsOf?.(index),
});

/** TypeScript generators that only work on the product runner. */
const typedProductOnly = new Set([
  "typed-object-mutations",
  "live-across-suspensions",
  "stack-overflow-points",
  "changing-buffers",
  "many-live-values",
  "throw-at-every-call",
  "values-across-joins",
  "operator-edge-cases",
  "objects-across-awaits",
  "all-microtask-kinds",
  "work-during-stack-unwinding",
  "dynamic-code-beside-compiled-code",
]);

const generated =
  (source: string, generate: Generator): Source =>
  (seed, runner) => {
    const random = new Random(seed);
    if ((source === "many-of-one-thing" || typedProductOnly.has(source)) && runner.name !== "product") return;
    const typed =
      typedProductOnly.has(source) || (source === "grammar" && runner.name === "product" && random.chance(0.5));
    const program: Program = {
      text: generate(random, typed, { library: runner.name === "product" }),
      extension: typed ? "ts" : "js",
    };
    return runner.accepts(program) && runner.allows(program.text)
      ? { source, seed, ...program, notes: typed ? "typed" : "untyped" }
      : undefined;
  };

// A program that starts itself as a Worker names its own file. One that loads code the build never saw changes what the
// compiler may assume about everything built beside it.
const standAlone = new Set([
  "workers-terminated-midway",
  "unseen-code-mutates-arguments",
  "number-arrays-through-map-filter",
  "first-iteration-decides-loop-test",
]);
const flagsOfSource: Record<string, string[]> = {
  "unseen-code-mutates-arguments": ["--aot-allow-code-from-disk"],
};

/** A source for the product runner only. `isTyped` says which seeds generate TypeScript. */
const productSource =
  (source: string, generate: Generator, isTyped: (seed: number) => boolean): Source =>
  (seed, runner) => {
    if (runner.name !== "product") return;
    const typed = isTyped(seed);
    const program: Program = {
      text: generate(new Random(seed), typed, { library: true }),
      extension: typed ? "ts" : "js",
      ...(flagsOfSource[source] ? { flags: flagsOfSource[source] } : {}),
    };
    return runner.accepts(program) && runner.allows(program.text)
      ? {
          source,
          seed,
          ...program,
          notes: typed ? "typed" : "untyped",
          ...(standAlone.has(source) ? { needsOwnBuild: true as const } : {}),
        }
      : undefined;
  };
const always = () => true;
const never = () => false;
const oddSeeds = (seed: number) => seed % 2 === 1;

/**
 * `rejected` receives the names of base programs that cannot be used; the caller adds those that already differ
 * unchanged. With `alsoMultiFile` each source is also registered as `<name>-multi-file`.
 */
export async function allSources(
  programsRoot: string,
  rejected: Set<string>,
  alsoMultiFile = false,
): Promise<Record<string, Source>> {
  const sources = await singleFileSources(programsRoot, rejected);
  const written = Object.entries(sources).map(
    ([name, source]) => [name + rewrittenSuffix, asRewritten(source)] as const,
  );
  if (alsoMultiFile)
    for (const [name, source] of Object.entries(sources)) sources[name + multiFileSuffix] = asMultiFile(source);
  return { ...sources, ...Object.fromEntries(written) };
}

async function singleFileSources(programsRoot: string, rejected: Set<string>): Promise<Record<string, Source>> {
  const sources: Record<string, Source> = {};
  const mutants = mutation(programsRoot, rejected);
  if (mutants) sources.mutation = mutants;
  const unchanged = storedPrograms(programsRoot, "stored-programs", (seed, count) => seed % count);
  if (unchanged) sources["stored-programs"] = unchanged;
  const shuffled = storedPrograms(programsRoot, "stored-programs-shuffled", (seed, count) =>
    new Random(seed).between(0, count - 1),
  );
  if (shuffled) sources["stored-programs-shuffled"] = shuffled;
  const pairs = allocationUsePairs();
  if (pairs) sources["allocation-use-pairs"] = pairs;
  for (const name of [
    "one-key-all-operations",
    "encode-into-subarrays",
    "arrays-shifted-during-gc",
    "bind-spread-flatmap-idioms",
    "manual-prototype-chains",
    "sorts-with-hostile-comparators",
    "promise-job-order",
    "await-chains-from-host-callbacks",
    "arrays-grown-from-empty-literals",
    "closure-fields-replaced",
    "tail-calls-forwarding-rest",
    "throwing-host-functions",
    "builtin-members-as-values",
    "many-live-values-across-blocks",
    "field-stores-in-loops",
    "field-stores-in-unknown-callbacks",
  ])
    sources[name] = productSource(name, generateOf(name), oddSeeds);
  sources["computed-key-stores-with-mutations"] = productSource(
    "computed-key-stores-with-mutations",
    generateOf("computed-key-stores-with-mutations"),
    seed => seed % 3 === 1,
  );
  // These generators take more than a random number: the seed also enumerates their tables.
  const bySeed =
    (
      name: string,
      isTyped: (seed: number) => boolean,
      textOf: (module: any, seed: number, typed: boolean) => string,
    ): Source =>
    (seed, runner) =>
      productSource(name, (_, typed) => textOf(require(`./${name}.ts`), seed, typed), isTyped)(seed, runner);
  sources["builtin-keys-after-reads"] = bySeed("builtin-keys-after-reads", oddSeeds, ({ generate }, seed, typed) =>
    generate(new Random(seed), typed, seed % 4 >= 2),
  );
  sources["builtin-keys-with-lazy-members"] = bySeed(
    "builtin-keys-with-lazy-members",
    oddSeeds,
    ({ generate, holders, numberOfForms }, seed, typed) =>
      generate(
        new Random(seed),
        typed,
        holders[seed % holders.length],
        Math.floor(seed / holders.length) % numberOfForms,
      ),
  );
  sources["builtin-keys-beside-lowered-code"] = bySeed(
    "builtin-keys-beside-lowered-code",
    never,
    ({ generate, holders, numberOfRounds, uses }, seed) =>
      generate(
        new Random(seed),
        holders[seed % holders.length],
        uses[Math.floor(seed / holders.length) % uses.length],
        Math.floor(seed / (holders.length * uses.length)) % numberOfRounds,
      ),
  );
  if (existsSync(join(import.meta.dir, "unsound-types.ts"))) {
    const { draw } = await import("./unsound-types.ts");
    sources["unsound-types"] = (seed, runner) => {
      if (runner.name !== "product") return;
      const { text, hole, parts, alone } = draw(new Random(seed));
      return {
        source: "unsound-types",
        seed,
        text,
        extension: "ts",
        notes: parts.map(each => each.join(", ")).join(" | "),
        group: hole,
        alone,
        isForTypeScript: true,
      };
    };
  }
  for (const name of [
    "grammar",
    "protocols",
    "new-targets",
    "object-mutations",
    "typed-object-mutations",
    "live-across-suspensions",
    "stack-overflow-points",
    "many-of-one-thing",
    "changing-buffers",
    "many-live-values",
    "throw-at-every-call",
    "values-across-joins",
    "operator-edge-cases",
    "objects-across-awaits",
    "all-microtask-kinds",
    "work-during-stack-unwinding",
    "dynamic-code-beside-compiled-code",
    "object-mutation-sequences",
  ])
    sources[name] = generated(name, generateOf(name));
  for (const name of [
    "out-of-memory-recovery",
    "single-reference-objects",
    "uncaught-errors",
    "shapes-collected-and-recreated",
    "workers-terminated-midway",
    "calls-with-many-arguments",
    "rope-strings",
    "string-width-change-under-substrings",
    "mutation-during-iteration",
    "abandoned-generators",
    "number-range-boundaries",
    "representation-boundaries",
    "dynamic-regexps",
    "arrays-read-where-allocated",
    "number-representations-as-arguments",
    "objects-read-where-allocated",
    "regexp-heavy-backtracking",
    "throwing-unused-expressions",
    "operand-dependent-throws",
    "constant-arrays-mutated",
    "fresh-objects-retained-by-builtins",
    "typed-instances-mutated-by-builtins",
    "typed-object-mutation-sequences",
    "aliases-at-control-flow-merge",
    "objects-with-many-fields",
    "polymorphic-variable",
    "objects-retained-by-host",
    "closures-read-through-array-methods",
    "per-iteration-objects",
    "regexp-with-derived-subjects",
    "body-json-encodings",
    "last-reference-read-during-allocation",
    "builtin-subclass-instances-frozen",
    "unseen-code-mutates-arguments",
    "number-arrays-through-map-filter",
    "first-iteration-decides-loop-test",
    "loops-over-outer-variables",
    "loop-counter-passed-to-call",
    "non-instances-under-class-type",
    "same-keys-different-member-classes",
    "atom-tables-and-string-conversion",
    "builtin-allocation-after-full-heap",
    "static-fields-outside-declared-type",
    "int32-fields-by-computed-key",
    "mistyped-values-through-generics",
    "mistyped-values-after-type-test",
    "unassigned-class-variables-used",
    "json-stringify-cycles",
    "json-stringify-cyclic-records",
    "closures-over-mistyped-values",
    "class-definition-throws",
    "element-field-test-store-reload",
    "many-allocations-one-escapes",
    "polymorphic-variable-destructured",
    "spread-arrays-on-rare-path",
  ])
    sources[name] = productSource(name, generateOf(name), always);
  for (const name of [
    "declarations-inside-builtin-callbacks",
    "runtime-detection",
    "declarations-under-call-and-apply",
    "factories-with-own-prototypes",
    "hot-indirect-builtin-calls",
    "liveness-around-suspension",
    "tail-calls-into-dynamic-code",
    "arguments-for-early-return-callee",
    "callbacks-around-awaits",
    "early-return-before-argument-use",
    "indexed-stores-under-intercepting-prototype",
    "integer-sums-near-double-precision",
    "host-throws-inside-builtin-callbacks",
    "call-site-with-two-builtins",
    "element-test-store-reload",
    "closures-in-loops",
    "optional-chains",
    "stack-positions-after-constant-folding",
    "builtin-protocol-mutates-held-object",
    "closures-tested-before-escape",
    "awaited-results-after-null-check",
    "maybe-missing-linked-objects",
    "high-register-pressure",
    "string-concatenation-on-many-paths",
    "calls-into-dynamic-code",
    "helper-defines-members-by-name",
    "long-mixed-array-literals",
    "key-order-of-built-objects",
    "stores-after-prototype-chain-changes",
    "element-presence-in-lists-from-builtins",
  ])
    sources[name] = productSource(name, generateOf(name), never);
  const named =
    (source: string, drawn: Drawn): Source =>
    (seed, runner) => {
      const made = drawn(seed, runner);
      return made && { source, ...made };
    };
  const inWords = (name: string) => name.replaceAll("-", " ");
  // Modules that count their programs and return the one at an index.
  for (const name of [
    "class-named-in-dead-code",
    "unused-declaration-side-effects",
    "fresh-object-copy-source",
    "host-object-round-trip-keys",
    "typed-array-loop-wrong-argument",
    "loop-tests-lazy-value",
    "computed-key-nullish-check",
    "proxy-trap-added-later",
    "typed-array-min-max-select",
    "module-variable-in-dead-code",
    "opaque-object-getter-during-walk",
    "many-keys-shadowing-prototype",
    "class-factories",
    "host-getters-by-computed-key",
    "type-only-files",
    "mixed-array-storage-parameter",
    "typed-array-element-range-edges",
    "mixed-field-storage-parameter",
    "element-loop-with-surrounding-code",
    "dynamic-regexp-quadratic-runs",
    "typed-array-sum-initial-values",
    "writes-to-object-copies",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts")))
      sources[name] = named(name, table(inWords(name), tableOf(name)));
  // Modules that return whole multi-file programs.
  for (const name of [
    "function-with-one-unusual-caller",
    "rare-iteration-changes-loop-state",
    "literal-accessor-order",
    "literal-argument-used-by-callee",
    "tail-calls-in-builtin-callbacks",
    "mixin-classes",
    "closures-and-evaluation-order",
    "closure-escape-paths",
    "data-imports-in-cycles",
    "partial-construction-seen-in-catch",
    "json-stringify-sizes-and-nesting",
    "keys-and-json-after-mutation",
    "reads-beside-defined-accessor",
    "reimport-after-evaluation",
    "object-escape-paths",
    "one-builtin-two-call-sites",
    "builtin-own-properties-by-name",
    "private-names-on-foreign-objects",
    "type-checks-on-mispredicted-member",
    "type-checks-on-mispredicted-value",
    "symbol-keys-from-one-site",
    "top-level-const-tables-mutated",
    "aliased-read-store-reload",
    "module-variables-during-evaluation",
    "variables-stored-during-suspension",
    "single-mutation-during-iteration",
    "unnamed-but-observable",
    "resume-order-after-settled-await",
    "callee-reassigned-during-call",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts")))
      sources[name] = named(
        name,
        whole(inWords(name), generateOf(name), seed => new Random(seed)),
      );
  // The lists in ./sources, each registered under its file name (family.ts).
  const lists = join(import.meta.dir, "sources");
  for (const file of existsSync(lists) ? readdirSync(lists).sort() : [])
    sources[file.replace(/\.ts$/, "")] = named(file.replace(/\.ts$/, ""), (seed, runner) =>
      require(`./sources/${file}`).default(seed, runner),
    );
  return sources;
}
