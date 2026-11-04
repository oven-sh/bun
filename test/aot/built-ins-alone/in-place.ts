// Programs that call a built-in as its row of the table describes it and ask IN PLACE what came back: `typeof result === "string"` stands where the
// result is, and again where each value inside it is. A compiler that believes it knows the answer prints its belief there. A question that
// goes through a helper (`show(value)`) cannot see a false belief: the parameter of the helper sees values of all kinds, so nothing is believed of it.
//
// The questions also ask what the row denies: of what it calls an object, whether it is a string, a number, undefined.
import { evaluate, printsTheSameTwice, within } from "./evaluate";
import { lines, type Program } from "./program";
import type { Row } from "./table";
import { matches, neverEvaluated, plansOf, shapeOf, volatileRows, wordsOf, write, type Plan } from "./table-driven";

const kinds = ["undefined", "boolean", "number", "string", "bigint", "symbol", "function", "object"];
/** The classes whose prototype object a result is compared with, by name: those with classes above or below them among the built-ins. */
const exactClasses = [
  ...["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "Buffer"],
  ...["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError", "SuppressedError", "DOMException"],
  ...["Map", "Set", "WeakMap", "WeakSet", "Promise", "Date", "RegExp", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Blob", "File", "Request", "Response", "Headers", "URL", "URLSearchParams", "Event", "CustomEvent", "EventTarget", "AbortSignal"],
];
const classes = ["Object", "Array", "Map", "Set", "Promise", "Date", "RegExp", "Error", "ArrayBuffer", "Uint8Array", "Function"];
const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const mostValuesAsked = 4;
const blocksInOneProgram = 30;

const kindsOf = (text: string) => [...kinds.map(kind => `typeof ${text} === "${kind}"`), `${text} === null`].join(", ");
const quoted = (text: string) => JSON.stringify(text);
const isObject = (value: unknown): value is object => (typeof value === "object" && value !== null) || typeof value === "function";

/** The objects that are there before the program starts: what the global object names, and what those name or have above them. */
const comesWithTheRealm = new Set<object>();
function noteWhatComesWithTheRealm(value: unknown, depth: number) {
  if (!isObject(value) || comesWithTheRealm.has(value)) return;
  comesWithTheRealm.add(value);
  noteWhatComesWithTheRealm(Object.getPrototypeOf(value), depth);
  if (depth === 0) return;
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if ("value" in property) noteWhatComesWithTheRealm(property.value, depth - 1);
  }
}
noteWhatComesWithTheRealm(globalThis, 3);

function upToSome(head: string, body: string[]) {
  return ["{", "  let asked = 0;", `  ${head} {`, `    if (asked++ === ${mostValuesAsked}) break;`, ...body.map(line => `    ${line}`), "  }", "}"];
}

/** Statements that ask what `name` holds. `value` is what it held when the program was written: it chooses the questions, never the answers. */
async function questions(name: string, label: string, value: unknown, isVolatile: boolean, depth: number): Promise<string[]> {
  const asked = [`console.log(${quoted(`${label}:`)}, ${kindsOf(name)});`];
  const ask = (what: string, ...texts: string[]) => asked.push(`console.log(${quoted(`${label}, ${what}:`)}, ${texts.join(", ")});`);
  if (typeof value === "number" && !isVolatile)
    ask("the number", `Number.isInteger(${name})`, `${name} === ${name}`, `${name} < 0`, `${name} > 2147483647`, `${name} < -2147483648`, `Object.is(${name}, -0)`, `(${name} | 0) === ${name}`);
  if (typeof value === "string" && !isVolatile) ask("the text", `${name}.length === 0`, `${name} === ""`);
  if (typeof value === "boolean" && !isVolatile) ask("the boolean", `${name} === true`, `${name} === false`, `!${name}`);
  if (!isObject(value)) return asked;

  ask("the class", `Array.isArray(${name})`, ...classes.map(each => `${name} instanceof ${each}`), `ArrayBuffer.isView(${name})`);
  ask("above it", `Object.getPrototypeOf(${name}) === Object.prototype`, `Object.getPrototypeOf(${name}) === Array.prototype`, `Object.getPrototypeOf(${name}) === null`);
  // A row may say "some typed array", "some error": the object has the prototype of ITS class, and a compiler that takes the class of the row for the class of the object folds these the wrong way.
  const itsClass = exactClasses.find(each => Object.getPrototypeOf(value) === (globalThis as any)[each]?.prototype);
  if (itsClass) {
    const parent = Object.getPrototypeOf((globalThis as any)[itsClass].prototype);
    ask(
      "its own class",
      `Object.getPrototypeOf(${name}) === ${itsClass}.prototype`,
      `Reflect.getPrototypeOf(${name}) === ${itsClass}.prototype`,
      `${name}.constructor === ${itsClass}`,
      ...(parent === null ? [] : [`Object.getPrototypeOf(${name}) === Object.getPrototypeOf(${itsClass}.prototype)`]),
    );
  }
  // An executable locks some of the objects that the language and the host come with.
  if (!comesWithTheRealm.has(value)) ask("its state", `Object.isFrozen(${name})`, `Object.isSealed(${name})`, `Object.isExtensible(${name})`);
  ask("names in it", ...["length", "size", "then", "next", "constructor"].map(key => `${quoted(key)} in ${name}`), `Symbol.iterator in ${name}`);
  if (depth === 0) return asked;

  const keys = Object.keys(value);
  if (!isVolatile) ask("how many keys", `Object.keys(${name}).length`);
  if (keys.length > 0) {
    asked.push(...upToSome(`for (const value of Object.values(${name}))`, [`console.log(${quoted(`${label}, by Object.values:`)}, ${kindsOf("value")});`]));
    asked.push(...upToSome(`for (const [key, value] of Object.entries(${name}))`, [`console.log(${quoted(`${label}, by Object.entries:`)}, typeof key === "string", ${kindsOf("value")});`]));
    asked.push(...upToSome(`for (const key in ${name})`, [`console.log(${quoted(`${label}, by for-in:`)}, typeof key === "string", ${kindsOf(`${name}[key]`)});`]));
    for (const key of keys.filter(key => identifier.test(key)).slice(0, mostValuesAsked)) {
      const member = (value as Record<string, unknown>)[key];
      asked.push(...(await questions(`${name}.${key}`, `${label}.${key}`, member, isVolatile, isObject(member) ? depth - 1 : 0)));
    }
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    ask("by index", kindsOf(`${name}[0]`));
    if (!isVolatile) ask("its length", `${name}.length === 0`, `${name}.length`);
    const first = (value as unknown as unknown[])[0];
    if (isObject(first)) asked.push(...(await questions(`${name}[0]`, `${label}[0]`, first, isVolatile, depth - 1)));
  }
  if (value instanceof Promise) {
    const unsettled = Symbol();
    const settled = await within(
      value.catch(() => unsettled),
      unsettled,
    );
    if (settled !== unsettled) asked.push("{", `  const settled = await ${name};`, ...(await questions("settled", `${label}, settled`, settled, isVolatile, depth - 1)).map(line => `  ${line}`), "}");
  } else if (Symbol.iterator in value) {
    // Last: an iterator is used up by it.
    asked.push(
      ...upToSome(`for (const value of ${name})`, [
        `console.log(${quoted(`${label}, by for-of:`)}, ${kindsOf("value")}, Array.isArray(value));`,
        `if (Array.isArray(value)) console.log(${quoted(`${label}, by for-of, the pair:`)}, ${kindsOf("value[0]")}, ${kindsOf("value[1]")});`,
      ]),
    );
  }
  return asked;
}

const importLine = /^import .* from ".*";$/;

type Block = { imports: string[]; text: string };

async function finish(plan: Plan, label: string, isVolatile: boolean, declarations: string[], operands: string[], more: string[]): Promise<Block | null> {
  const imports = plan.setup.filter(line => importLine.test(line));
  const head = [...plan.setup.filter(line => !importLine.test(line)), ...declarations];
  const evaluation = await evaluate(lines(imports, head, "return [result];"));
  if (evaluation.failed) return null;
  const same = operands.length === 0 ? [] : [`console.log(${quoted(`${label}, is it an operand:`)}, ${operands.map(name => `result === ${name}`).join(", ")});`];
  const body = [...head, ...same, ...more, ...(await questions("result", label, (evaluation.value as [unknown])[0], isVolatile, 2))];
  // A function of its own for each call: what stands at the top of a module runs once, and the compiler spends little on it.
  const text = lines("await (async function () {", "  try {", body.map(line => `    ${line}`), "  } catch (error) {", `    console.log(${quoted(`${label}: it threw`)}, error instanceof Error);`, "  }", "})();");
  return (await printsTheSameTwice(lines(imports, text))) === null ? null : { imports, text };
}

/** The call as the row describes it, and for a constructor the two other ways to reach it: from a class below it, and for another `new.target`. */
async function blocksOf(plan: Plan, label: string, isVolatile: boolean): Promise<Block[]> {
  const written = write(plan);
  const quiet = written.callbacks.flatMap(name => [`function ${name}() {`, "  return true;", "}"]);
  const declarations = [...written.declarations, ...quiet];
  const operands = written.names.filter(name => name !== null && identifier.test(name)) as string[];
  const call = plan.overload.mode === "Set" ? `(${written.call})` : written.call;
  const type = plan.overload.result.type;
  // What the row says in constants: the compiler folds these by the row, plain Bun computes them.
  const constants = [
    type.stringLiterals.length > 0 && `console.log(${quoted(`${label}, is it a text that its row names:`)}, ${type.stringLiterals.map(text => `result === ${quoted(text)}`).join(" || ")});`,
    type.integers !== null && `console.log(${quoted(`${label}, does it lie where its row says:`)}, typeof result !== "number" || (result >= ${type.integers.minimum} && result <= ${type.integers.maximum}));`,
  ].filter(line => typeof line === "string");
  // What the row calls new is none of what was there before, and a second call makes another.
  const isNew = type.freshness === "Yes" || type.freshness === "Unaliased";
  const again = isNew && plan.overload.mode !== "Get" ? [`const again = ${call};`, `console.log(${quoted(`${label}, does a second call answer the same thing:`)}, result === again);`] : [];
  const forms = [finish(plan, label, isVolatile, [...declarations, `const result = ${call};`], operands, [...constants, ...again])];
  // A row that answers one of its operands is entered in every way that a function can be: the operand is the same one in each.
  const member = plan.overload.mode === "Call" && type.parts.some(part => part.part === "Operand") ? /^(.*?)(\.[A-Za-z_$][A-Za-z0-9_$]*|\[Symbol\.[A-Za-z]+\])\(([^]*)\)$/.exec(written.call) : null;
  if (member && !/[()]/.test(member[1])) {
    const [, holder, accessor, passed] = member;
    const rest = passed.trim() === "" ? "" : `, ${passed}`;
    for (const [way, text] of [
      ["by call", `${holder}${accessor}.call(${holder}${rest})`],
      ["by apply", `${holder}${accessor}.apply(${holder}, [${passed}])`],
      ["by Reflect.apply", `Reflect.apply(${holder}${accessor}, ${holder}, [${passed}])`],
      ["by a bound function", `${holder}${accessor}.bind(${holder})(${passed})`],
    ])
      forms.push(finish(plan, `${label}, ${way}`, isVolatile, [...declarations, `const result = ${text};`], operands, constants));
  }
  const construction = plan.overload.mode === "Construct" ? /^new ([A-Za-z_$][A-Za-z0-9_$.]*)\((.*)\)$/s.exec(written.call) : null;
  if (construction) {
    const [, constructor, passed] = construction;
    const parameters = plan.passed.map((_, index) => `p${index}`).join(", ");
    forms.push(
      finish(
        plan,
        `${label}, from a class below`,
        isVolatile,
        // The operands are spelled out: through a rest parameter the compiler would lose sight of them, and believe nothing.
        [...declarations, `class Below extends ${constructor} {`, "  mark = 1;", `  constructor(${parameters}) {`, `    super(${parameters});`, "    this.late = 2;", "  }", "}", `const result = new Below(${passed});`],
        operands,
        [`console.log(${quoted(`${label}, from a class below, the class:`)}, result instanceof Below, Object.getPrototypeOf(result) === Below.prototype, result.mark === 1, result.late === 2, typeof result.mark === "number", typeof result.late === "undefined");`],
      ),
      finish(plan, `${label}, for another new.target`, isVolatile, [...declarations, "function Other() {}", `const result = Reflect.construct(${constructor}, [${passed}], Other);`], operands, [
        `console.log(${quoted(`${label}, for another new.target, the class:`)}, result instanceof Other, Object.getPrototypeOf(result) === Other.prototype);`,
      ]),
    );
  }
  return (await Promise.all(forms.map(form => form.catch(() => null)))).filter(block => block !== null);
}

export const rowsNotAsked = new Map<string, string>();
const differsFromMachineToMachine = [/^(Bun|process)\.env$/, /^process\.(config|release|features|versions|report|argv|execArgv|execPath|argv0)$/, /^Bun\.(argv|main|which|cwd)$/, /^navigator\./];

/** The rows of the table that are asked about, by the holder of the built-in: the rows of one holder share their programs, which are named after it. */
export function rowsByHolder(described: Row[]): Map<string, Row[]> {
  const only = process.env.ONLY_ROWS === undefined ? null : new RegExp(process.env.ONLY_ROWS);
  const holders = new Map<string, Row[]>();
  for (const row of described) {
    if (only !== null && !only.test(row.path)) continue;
    if (matches(neverEvaluated, row.path)) {
      rowsNotAsked.set(row.path, "not called while the programs are written");
      continue;
    }
    if (matches(differsFromMachineToMachine, row.path)) {
      rowsNotAsked.set(row.path, "what it answers has other names on another machine");
      continue;
    }
    const shape = shapeOf(row.path);
    const holder = wordsOf(shape.holder === "" ? "globals" : shape.holder) || "globals";
    const rows = holders.get(holder);
    if (rows === undefined) holders.set(holder, [row]);
    else rows.push(row);
  }
  return holders;
}

/** The programs of each holder. */
export async function inPlacePrograms(holders: Map<string, Row[]>): Promise<Map<string, Program[]>> {
  const byHolder = new Map<string, { row: string; imports: string[]; text: string }[]>();
  for (const [holder, row] of [...holders].flatMap(([holder, rows]) => rows.map(row => [holder, row] as const))) {
    const isVolatile = matches(volatileRows, row.path);
    const texts = new Set<string>();
    for (const overload of row.trusted) {
      if (overload.mode === "Set") continue;
      for (const flavor of ["mixed", "items", "empty"] as const) {
        for (const plan of (await plansOf(row, overload, flavor)).slice(0, 2)) {
          const label = `${row.path}${overload.mode === "Call" ? "" : `, ${overload.mode.toLowerCase()}`}${texts.size === 0 ? "" : `, form ${texts.size + 1}`}`;
          for (const block of await blocksOf(plan, label, isVolatile)) {
            const bare = block.text.replaceAll(label, "");
            if (texts.has(bare)) continue;
            texts.add(bare);
            byHolder.set(holder, [...(byHolder.get(holder) ?? []), { row: row.path, ...block }]);
          }
        }
      }
    }
    if (texts.size === 0) rowsNotAsked.set(row.path, "no call of it with sample operands succeeds and prints the same twice");
  }
  const programs = new Map<string, Program[]>();
  for (const [holder, blocks] of [...byHolder].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const parts = Math.ceil(blocks.length / blocksInOneProgram);
    programs.set(holder, []);
    for (let part = 0; part < parts; part++) {
      const some = blocks.slice(part * blocksInOneProgram, (part + 1) * blocksInOneProgram);
      programs.get(holder)!.push({
        name: parts === 1 ? holder : `${holder}-${part + 1}`,
        rows: [...new Set(some.map(block => block.row))],
        extension: "mjs",
        text: lines(
          `// What these built-ins answer is asked in place, with no helper between the value and the question. Written by test/aot/generate-built-ins-asked-in-place.ts from the table of built-ins.`,
          [...new Set(some.flatMap(block => block.imports))],
          "// Some of what is made here is a promise that rejects, and nobody waits for it.",
          'process.on("unhandledRejection", () => {});',
          some.map(block => block.text),
          "// A timer or a listener that was made on the way would keep the program alive.",
          "process.exit(0);",
        ),
      });
    }
  }
  return programs;
}
