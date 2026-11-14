// Rewrites a generated program so that built-in functions stand where it hands over functions of its own: as callbacks, as traps, as methods of an object that a built-in calls.
// A generated program declares every function that it hands over. Ordinary code writes `list.filter(Boolean)`, and then the compiler knows the callee of a call inside the library.
import { randomFrom } from "./print-members-of-objects.ts";

/** Built-ins that answer a question about one value. */
export const predicates = [
  "Boolean",
  "Boolean",
  "Boolean",
  "Array.isArray",
  "Array.isArray",
  "Number.isInteger",
  "Number.isFinite",
  "Number.isNaN",
  "Number.isSafeInteger",
  "isNaN",
  "isFinite",
  "Object.isFrozen",
  "Object.isExtensible",
  "ArrayBuffer.isView",
  "Error.isError",
];

/** Built-ins that make one value of another. */
export const conversions = [
  "Number",
  "Number",
  "String",
  "String",
  "Object",
  "Array",
  "Symbol",
  "BigInt",
  "parseInt",
  "parseFloat",
  "Number.parseFloat",
  "Math.abs",
  "Math.floor",
  "Math.ceil",
  "Math.round",
  "Math.trunc",
  "Math.sign",
  "Math.sqrt",
  "Math.fround",
  "Math.clz32",
  "JSON.stringify",
  "JSON.parse",
  "Array.of",
  "Array.from",
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.fromEntries",
  "Object.freeze",
  "Object.getPrototypeOf",
  "Object.getOwnPropertyNames",
  "Object.create",
  "Reflect.ownKeys",
  "Reflect.getPrototypeOf",
  "String.fromCharCode",
  "String.fromCodePoint",
  "String.raw",
  "Symbol.for",
  "encodeURIComponent",
  "decodeURIComponent",
  "escape",
  "structuredClone",
  "Iterator.from",
  "Promise.resolve.bind(Promise)",
];

/** Built-ins that take two values or more. */
export const combinations = [
  "Math.max",
  "Math.max",
  "Math.min",
  "Math.pow",
  "Math.imul",
  "Math.hypot",
  "Math.atan2",
  "Object.is",
  "Object.assign",
  "Object.hasOwn",
  "Array.of",
  "Reflect.has",
  "Reflect.get",
  "Reflect.set",
  "Reflect.apply",
  "Reflect.construct",
  "Reflect.defineProperty",
  "Reflect.deleteProperty",
  "Reflect.getOwnPropertyDescriptor",
  'String.prototype.concat.bind("")',
];

/** Constructors, methods that are cut off from their objects, and functions that are bound. */
const others = [
  "Map",
  "Set",
  "WeakMap",
  "RegExp",
  "Error",
  "TypeError",
  "Promise",
  "Uint8Array",
  "Float64Array",
  "ArrayBuffer",
  "Array.prototype.push",
  "Array.prototype.slice",
  "Array.prototype.concat",
  "Array.prototype.join",
  "Array.prototype.includes",
  "Array.prototype.values",
  "Array.prototype.at",
  "String.prototype.trim",
  "String.prototype.toUpperCase",
  "String.prototype.charCodeAt",
  "Object.prototype.toString",
  "Object.prototype.valueOf",
  "Object.prototype.hasOwnProperty",
  "Number.prototype.valueOf",
  "Function.prototype",
  "Function.prototype.call",
  "Function.prototype.call.bind(Array.prototype.slice)",
  "Function.prototype.call.bind(String.prototype.toUpperCase)",
  'Array.prototype.includes.bind([1, 2, "a"])',
  "Object.prototype.hasOwnProperty.bind({ a: 1, 0: 1 })",
  'Set.prototype.has.bind(new Set([1, 2, "a"]))',
  "Math.max.bind(null, 3)",
  "RegExp.prototype.test.bind(/1|a/)",
];

// A function of the generator is `f1` or `F1`. It is handed over where it is an argument or the value of a property, with a cast or without one.
const handedOver = /(?<=[(,] ?|[\w$"\]]: )(\()?\b[fF]\d+\b( as any\))?(?=[,)]| \})/g;

/**
 * `text` with built-in functions in place of some of the functions that it hands over.
 * One program in three has one such place, the others three in ten or seven in ten of their places.
 */
export function handOverBuiltIns(text: string, isTypeScript: boolean) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const random = randomFrom("built-ins" + text);
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  // A name in the braces of an import, an export or a pattern is declared or listed there, not handed over.
  const isListed = (index: number) =>
    /^\s*(?:import|export)\b|\b(?:const|let|var) \{[^}=]*$/.test(
      program.slice(program.lastIndexOf("\n", index) + 1, index),
    );
  const places = [...program.matchAll(handedOver)].filter(found => !found[1] === !found[2] && !isListed(found.index));
  if (places.length === 0) return text;
  const share = pick([0, 0.3, 0.7]);
  const theOne = pick(places).index;
  // Most programs draw from a few built-ins, so that one of them is the only callee that a function of the library sees.
  const few = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
    pick(pick([predicates, predicates, conversions, conversions, combinations, others])),
  );
  const rewritten = program.replace(handedOver, (whole, open, close, index) => {
    if (!open !== !close || isListed(index) || (share === 0 ? index !== theOne : random() > share)) return whole;
    const builtIn = pick(few);
    return isTypeScript ? `(${builtIn} as any)` : /[ (]/.test(builtIn) ? `(${builtIn})` : builtIn;
  });
  return rewritten + otherFiles.join("");
}

/**
 * `text` with a `printValue` that appends to a text, which is printed at the end.
 * `console.log` is a call of the host, and the compiler knows nothing about what such a call does. A function that appends to a variable is one that it sees through.
 */
export function keepWhatIsPrintedInAText(text: string, isTypeScript: boolean) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const first = "const printValue = console.log;\n";
  if (!program.startsWith(first) || program.includes("everythingPrinted")) return text;
  const [values, value, nothing] = isTypeScript
    ? ["...values: unknown[]", "value: unknown", ": void"]
    : ["...values", "value", ""];
  const head = [
    'let everythingPrinted = "";',
    `function shownInTheText(${value})${isTypeScript ? ": string" : ""} { return (typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol" ? typeof value : String(value); }`,
    `function printValue(${values})${nothing} { for (const value of values) everythingPrinted += shownInTheText(value) + " "; everythingPrinted += "\\n"; }`,
    "",
  ].join("\n");
  const body = program.slice(first.length).replaceAll('console.log("noted", ', 'printValue("noted", ');
  const end = /\nexport \{\};\n*$/.exec(body);
  const last = "console.log(everythingPrinted);\n";
  return (
    head +
    (end ? body.slice(0, end.index + 1) + last + body.slice(end.index + 1) : body.replace(/\n*$/, "\n") + last) +
    otherFiles.join("")
  );
}

// In a module each of these can be declared. Where the program names one, the binding decides what is meant, not the text.
const namesOfGlobals = [
  "NaN",
  "NaN",
  "Infinity",
  "Array",
  "Object",
  "Number",
  "String",
  "Boolean",
  "Math",
  "JSON",
  "Symbol",
  "Reflect",
  "Promise",
  "Map",
  "Set",
  "Error",
  "isNaN",
  "parseInt",
  "Iterator",
  "globalThis",
  "process",
  "Bun",
  "console",
  "require",
  "module",
  "exports",
];

/** `text` with one or two of its variables, functions, classes and parameters under the name of a global. */
export function giveNamesOfGlobals(text: string) {
  const random = randomFrom("names" + text);
  const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)];
  const declared = [
    ...new Set(
      [...text.matchAll(/\b(?:const|let|function|class) ([vfFC]\d+)\b|[(,] ?(a\d+)\b(?=[,):= ])/g)].map(
        found => found[1] ?? found[2],
      ),
    ),
  ];
  if (declared.length === 0) return text;
  for (let count = 1 + Math.floor(random() * 2); count > 0; count--) {
    const [from, to] = [pick(declared), pick(namesOfGlobals)];
    // `console` is how the program prints.
    if (
      (to === "console" && text.includes("console.")) ||
      new RegExp(`\\b(?:const|let|function|class) ${to}\\b`).test(text)
    )
      continue;
    text = text.replace(new RegExp(`(?<![\\w$.])${from}\\b`, "g"), to);
    // A text that names one of these and shows no kind of module runs as CommonJS under `bun run`, where a `const` of that name at the top is declared twice.
    if (/^(?:require|module|exports)$/.test(to) && !/^(?:import|export)\b/m.test(text)) text += "\nexport {};\n";
  }
  return text;
}

/**
 * `text` without some of its `try` blocks: what stood in one stands in a plain block, and its `catch` is gone.
 * The compiler keeps more in memory, and moves less, around code from which an exception can be caught. A statement that throws now ends the program, in both runs.
 */
export function unwrapTryBlocks(text: string) {
  const [program, ...otherFiles] = text.split(/^(?=\/\/ @filename: )/m);
  const random = randomFrom("try" + text);
  const share = random() < 0.3 ? 1 : 0.5;
  const lines = program.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // `try { v1 = f(); } catch (e) {}`
    const guarded = /^(\s*)try \{ (.*;) \} catch ?(?:\(\w+\) )?\{[^{}]*\}$/.exec(line);
    if (guarded && random() < share) {
      kept.push(guarded[1] + guarded[2]);
      continue;
    }
    const indent = /^(\s*)try \{$/.exec(line)?.[1];
    if (indent === undefined || random() >= share) {
      kept.push(line);
      continue;
    }
    const handler = lines.findIndex((other, at) => at > index && other.startsWith(indent + "}"));
    const end = /^\s*\} catch ?(?:\(\w+\) )?\{$/.test(lines[handler] ?? "")
      ? lines.findIndex((other, at) => at > handler && other.startsWith(indent + "}"))
      : -1;
    // A `finally` stays, and so does what this cannot follow.
    if (end < 0 || lines[end] !== indent + "}") {
      kept.push(line);
      continue;
    }
    lines[index] = indent + "{";
    lines.splice(handler, end - handler + 1, indent + "}");
    kept.push(lines[index]);
  }
  return kept.join("\n") + otherFiles.join("");
}
