import { evaluate, literalOf, printsTheSameTwice, within } from "./evaluate";
import { lines, ordinals, type Program } from "./program";
import {
  candidatesOf,
  classSamples,
  holderClasses,
  itemSetup,
  staticHolders,
  type Candidate,
  type Flavor,
} from "./samples";
import { auditPlan } from "./audit";
import type { Overload, Row, Table } from "./table";
import { Walker } from "./walker";

export const neverEvaluated = [
  /^eval$/,
  /^Function$/,
  /^%(Async)?(Generator)?Function%/,
  /^ShadowRealm/,
  /^WebAssembly/,
  /^Atomics\.(wait|waitAsync|pause|notify)$/,
  /^FinalizationRegistry/,
  /^%LinkTimeConstant/,
  /^%CompilerHelpers%/,
  /^%PrivateGlobals%/,
  /^%Module/,
  /^%ImportMeta%/,
  /^%bun:bundle%/,
  /^%.*(Server|Socket|Sink|Listener|Parser|Router|Native|Stat|Context|Address|BlockList|Request|Response).*%/,
  /^native:/,
  /^node:/,
  /^utf-8-validate/,
  /^(alert|confirm|prompt|fetch|postMessage|onmessage|onerror|Worker|HTMLRewriter|SubtleCrypto|CryptoKey|Crypto)\b/,
  /^(addEventListener|removeEventListener|AbortSignal|BuildMessage|ResolveMessage|URLPattern)\b/,
  /^(CompressionStream|DecompressionStream)\b/,
  /^console\./,
  /^process\.(_|abort|exit|reallyExit|kill|chdir|execve|binding|dlopen|loadEnvFile|report|set|initgroups|stdout|stderr|stdin|mainModule|emitWarning|assert|umask|title|debugPort|connected|exitCode|ref|unref)/,
  /^Bun\.(\$|Archive|FetchSession|FileSystemRouter|Image|RedisClient|S3Client|Transpiler|build|connect|cron|fetch|file|gc|generateHeapSnapshot|jest|listen|mmap|openInEditor|registerMacro|resolve|resolveSync|serve|shrink|spawn|spawnSync|udpSocket|which|write|dns|secrets|unsafe|password|CSRF|sleepSync|sleep|Cookie|CookieMap|markdown)\b/,
  /^performance\.(addEventListener|removeEventListener|dispatchEvent|onresourcetimingbufferfull|markResourceTiming|timing)/,
  /^Temporal/,
  /^Request\.prototype\.(signal|clone)/,
  /^%Timeout%\.prototype\._onTimeout/,
  /^performance\.measure/,
  /^Performance\.prototype\.measure/,
  /^%Timeout%\.prototype\._repeat/,
  // An executable is started with other variables than plain Bun.
  /^(Bun|process)\.env$/,
];

export const volatileRows = [
  /^performance\./,
  /^Performance\./,
  /^process\./,
  /^Bun\.(nanoseconds|randomUUIDv7|version|revision|main|cwd|isMainThread|allocUnsafe|pathToFileURL|fileURLToPath)/,
  /^Date\.now$/,
  /^Math\.random$/,
  /^Date$/,
  /^Buffer\.allocUnsafe/,
  /^Intl\./,
  /toLocale/,
  /^Date\.prototype\.(toString|toDateString|toTimeString|getTimezoneOffset)/,
  /^%Timeout%/,
  /^%Immediate%/,
];

export const matches = (patterns: RegExp[], path: string) => patterns.some(pattern => pattern.test(path));

export function wordsOf(path: string): string {
  return path
    .replace(/\.prototype\b/g, "")
    .replace(/\[Symbol\.([A-Za-z]+)\]/g, ".symbol-$1")
    .replace(/%/g, "")
    .replace(/\$/g, "dollar")
    .split(/[.:_]/)
    .filter(part => part !== "")
    .map(part =>
      part
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
        .toLowerCase(),
    )
    .join("-");
}

export interface Shape {
  holder: string;
  accessor: string;
  isOnPrototype: boolean;
}

export function shapeOf(path: string): Shape {
  const match = /^(.*?)(\.prototype)?(\.[A-Za-z_$][A-Za-z0-9_$]*|\[Symbol\.[A-Za-z]+\])$/.exec(path);
  if (match === null) return { holder: "", accessor: path, isOnPrototype: false };
  return { holder: match[1], accessor: match[3], isOnPrototype: match[2] !== undefined };
}

export interface Plan {
  row: Row;
  overload: Overload;
  shape: Shape;
  setup: string[];
  receiver: Candidate | null;
  passed: Candidate[];
}

const receiverNames: Record<string, string> = {
  Array: "list",
  Map: "map",
  Set: "set",
  String: "text",
  RegExp: "pattern",
  Date: "date",
  Promise: "promise",
};
const callbackNames = ["callback", "otherCallback", "thirdCallback"];

function isInline(candidate: Candidate): boolean {
  return candidate.class === undefined
    ? !/^[[{]/.test(candidate.text)
    : ["String", "Number", "Boolean", "BigInt"].includes(candidate.class);
}

export interface Written {
  declarations: string[];
  call: string;
  names: (string | null)[];
  callbacks: string[];
}

export function write(
  plan: Plan,
  replaced: Map<number, string> = new Map(),
  receiverMethod: string | null = null,
  holderName: string | null = null,
): Written {
  const declarations: string[] = [];
  const names: (string | null)[] = [];
  const callbacks: string[] = [];
  const operandText = (candidate: Candidate, index: number, name: string): string => {
    const replacement = replaced.get(index);
    if (replacement !== undefined) {
      names.push(replacement);
      return replacement;
    }
    if (candidate.isFunction) {
      const callback = callbackNames[callbacks.length];
      callbacks.push(callback);
      names.push(callback);
      return callback;
    }
    if (candidate.text === "item") {
      names.push("item");
      return "item";
    }
    if (isInline(candidate)) {
      names.push(null);
      return candidate.text;
    }
    declarations.push(`const ${name} = ${candidate.text};`);
    names.push(name);
    return name;
  };
  const receiver =
    plan.receiver === null
      ? null
      : operandText(plan.receiver, 0, receiverNames[plan.receiver.class ?? ""] ?? "subject");
  if (plan.receiver === null) names.push(null);
  const passed = plan.passed.map((candidate, index) =>
    operandText(candidate, index + 1, ordinals[index] ?? `operand${index}`),
  );
  const { holder, accessor, isOnPrototype } = plan.shape;
  const wrapped = receiver !== null && /^([0-9]|function|\{)/.test(receiver) ? `(${receiver})` : receiver;
  const callee = isOnPrototype
    ? `${wrapped}${receiverMethod ?? accessor}`
    : holder === ""
      ? (holderName ?? accessor)
      : `${holderName ?? staticHolders[holder] ?? holder}${accessor}`;
  const call =
    plan.overload.mode === "Construct"
      ? `new ${callee}(${passed.join(", ")})`
      : plan.overload.mode === "Call"
        ? `${callee}(${passed.join(", ")})`
        : plan.overload.mode === "Get"
          ? callee
          : `${callee} = ${passed[0]}`;
  return { declarations, call, names, callbacks };
}

export interface Recorded {
  self: unknown;
  passed: unknown[];
}

export const isItem = (value: unknown): value is { size: unknown } =>
  typeof value === "object" && value?.constructor?.name === "Item";
let recordersStore = false;

function recorder(records: Recorded[], answer: unknown) {
  return function (this: unknown, ...passed: unknown[]) {
    records.push({ self: this, passed });
    if (recordersStore) for (const each of passed) if (isItem(each)) each.size = "changed";
    return answer;
  };
}

export interface Outcome {
  item: unknown;
  result: unknown;
  operands: unknown[];
  before: string[];
  records: Recorded[][];
}

export const snapshot = (value: unknown) =>
  typeof value === "object" && value !== null ? Bun.inspect(value, { depth: 3 }) : "";

export async function attempt(
  plan: Plan,
  answer: unknown,
  extraNames: string[] = [],
  extraValues: unknown[] = [],
  written = write(plan),
  looksAtOperands = true,
): Promise<Outcome | null> {
  const records = written.callbacks.map(() => [] as Recorded[]);
  const operands = written.names.map(name => name ?? "undefined").join(", ");
  const text = lines(
    plan.setup,
    written.declarations,
    `const operands = [${operands}];`,
    "const before = operands.map(snapshot);",
    `const result = ${plan.overload.mode === "Set" ? `(${written.call})` : written.call};`,
    'return { result: [result], operands, before, item: typeof item === "undefined" ? undefined : item };',
  );
  const evaluation = await evaluate(
    text,
    ["snapshot", ...written.callbacks, ...extraNames],
    [looksAtOperands ? snapshot : () => "", ...records.map(list => recorder(list, answer)), ...extraValues],
  );
  if (evaluation.failed) return null;
  const value = evaluation.value as { result: [unknown]; operands: unknown[]; before: string[]; item: unknown };
  return { result: value.result[0], operands: value.operands, before: value.before, records, item: value.item };
}

function receiverCandidates(overload: Overload, shape: Shape, flavor: Flavor): Candidate[] {
  if (!shape.isOnPrototype) return [];
  const fromType =
    overload.receiver === null
      ? []
      : candidatesOf(overload.receiver.accepted, flavor).filter(each => each.class !== undefined);
  const holderClass = holderClasses[shape.holder] ?? shape.holder;
  const sample = classSamples[holderClass];
  const preferred = fromType.filter(each => each.class === holderClass);
  if (preferred.length > 0) return [...preferred, ...fromType.filter(each => each.class !== holderClass)];
  if (sample === undefined) return fromType;
  const text =
    (flavor === "empty" && sample.empty) ||
    (flavor === "numbers" && sample.numbers) ||
    (flavor === "items" && sample.items) ||
    sample.make(sample.base);
  return [{ text, class: holderClass }, ...fromType];
}

function setupOf(candidates: (Candidate | null)[]): string[] {
  const usesItem = candidates.some(candidate => {
    const more = candidate?.class === undefined ? undefined : classSamples[candidate.class]?.setup;
    return candidate !== null && /\bitem\b/.test([candidate.text, ...(more ?? [])].join(" "));
  });
  const setup: string[] = usesItem ? [...itemSetup] : [];
  for (const candidate of candidates) {
    const more = candidate?.class === undefined ? undefined : classSamples[candidate.class]?.setup;
    if (more !== undefined && !setup.includes(more[0])) setup.push(...more);
  }
  return setup;
}

const preferredOperands: Record<string, string[]> = {
  "String.prototype.padStart": ["8"],
  "String.prototype.padEnd": ["8"],
  "String.prototype.split": ['"n"'],
  "String.prototype.at": ["-1"],
  "Array.prototype.at": ["-1"],
  "Array.prototype.flat": ["1"],
  "JSON.parse": ['\'{ "first": 1.5, "second": ["two"] }\''],
  "Buffer.from": ['"banana"'],
  "Number.prototype.toString": ["16"],
  atob: ['"YmFuYW5h"'],
  "Buffer.prototype.readIntBE": ["0", "2"],
  "Buffer.prototype.readIntLE": ["0", "2"],
  "Buffer.prototype.readUIntBE": ["0", "2"],
  "Buffer.prototype.readUIntLE": ["0", "2"],
  "Buffer.prototype.writeIntBE": ["1", "0", "2"],
  "Buffer.prototype.writeIntLE": ["1", "0", "2"],
  "Buffer.prototype.writeUIntBE": ["1", "0", "2"],
  "Buffer.prototype.writeUIntLE": ["1", "0", "2"],
  "Headers.prototype.getAll": ['"Set-Cookie"'],
  "Bun.semver.order": ['"1.0.0"', '"2.0.0"'],
  "Bun.semver.satisfies": ['"1.5.0"', '"^1.0.0"'],
  "Math.sumPrecise": ["[1.5, 2.5]"],
  "Uint8Array.fromHex": ['"ff01"'],
  "Uint8Array.fromBase64": ['"YmFuYW5h"'],
  "Bun.inflateSync": ['Bun.deflateSync("banana")'],
  "Bun.gunzipSync": ['Bun.gzipSync("banana")'],
  "Bun.zstdDecompressSync": ['Bun.zstdCompressSync("banana")'],
  "Intl.supportedValuesOf": ['"unit"'],
  "Intl.DisplayNames": ['"en"', '{ type: "region" }'],
  "Bun.fileURLToPath": ['"file:///tmp/a.js"'],
  "Date.parse": ['"2026-01-02T03:04:05.678Z"'],
  "JSON.rawJSON": ['"1.5"'],
  "String.prototype.normalize": ['"NFC"'],
  decodeURI: ['"a%20b"'],
  decodeURIComponent: ['"a%20b"'],
  "BigInt.asIntN": ["8", "257n"],
  "BigInt.asUintN": ["8", "257n"],
  "Map.prototype.get": ['"second"'],
  "Map.prototype.has": ['"second"'],
  "Map.prototype.delete": ['"second"'],
  "Map.prototype.getOrInsert": ['"second"'],
  "Map.prototype.getOrInsertComputed": ['"second"'],
  "WeakMap.prototype.get": ["key"],
  "WeakMap.prototype.has": ["key"],
  "WeakMap.prototype.delete": ["key"],
  "WeakMap.prototype.getOrInsert": ["key"],
  "WeakSet.prototype.has": ["key"],
  "WeakSet.prototype.delete": ["key"],
};

export async function plansOf(row: Row, overload: Overload, flavor: Flavor): Promise<Plan[]> {
  const plan = await planOf(row, overload, flavor);
  if (plan === null) return [];
  const plans = [plan];
  if (flavor !== "mixed") return plans;
  const index = overload.parameters.findIndex(
    (parameter, position) =>
      position < plan.passed.length &&
      !plan.passed[position].isFunction &&
      (parameter.accepted.isAnything || parameter.accepted.hasAnyObject || parameter.accepted.hasPlainData),
  );
  if (index === -1) return plans;
  const position = { index, conversion: overload.parameters[index].conversion, followsFunction: false };
  for (const other of candidatesOf(overload.parameters[index].accepted, flavor, position)) {
    if (other.isFunction || plans.some(each => each.passed[index].text === other.text)) continue;
    const passed = plan.passed.with(index, other);
    const varied = { ...plan, passed, setup: setupOf([plan.receiver, ...passed]) };
    if ((await attempt(varied, true)) !== null) plans.push(varied);
  }
  return plans;
}

async function planOf(row: Row, overload: Overload, flavor: Flavor): Promise<Plan | null> {
  const shape = shapeOf(row.path);
  const receivers = receiverCandidates(overload, shape, flavor);
  if (shape.isOnPrototype && receivers.length === 0) return null;
  const choices: Candidate[][] = [];
  for (const [index, parameter] of overload.parameters.entries()) {
    const followsFunction = index > 0 && choices[index - 1]?.[0]?.isFunction === true;
    const candidates = candidatesOf(parameter.accepted, flavor, {
      index,
      conversion: parameter.conversion,
      followsFunction,
    });
    const preferred = preferredOperands[row.path]?.[index];
    if (
      preferred !== undefined &&
      candidates.length > 0 &&
      candidates[0].class === undefined &&
      !candidates[0].isFunction
    )
      candidates.unshift({ text: preferred });
    if (parameter.mode === "Rest") {
      if (candidates.length > 0)
        choices.push(candidates, candidates.length > 1 ? [candidates[1], ...candidates] : candidates);
      break;
    }
    if (candidates.length === 0 || (candidates[0].text === "undefined" && parameter.mode === "Optional")) break;
    choices.push(candidates);
  }
  const required = overload.parameters.filter(parameter => parameter.mode === "Required").length;
  let tries = 0;
  for (const receiver of receivers.length > 0 ? receivers.slice(0, 2) : [null]) {
    for (let count = choices.length; count >= Math.min(required, choices.length); count--) {
      const picked = choices.slice(0, count).map(each => each[0]);
      const make = (passed: Candidate[]): Plan => ({
        row,
        overload,
        shape,
        receiver,
        passed,
        setup: setupOf([receiver, ...passed]),
      });
      if ((await attempt(make(picked), true)) !== null) return make(picked);
      for (let index = 0; index < count; index++) {
        for (const other of choices[index].slice(1, 6)) {
          if (++tries > 40) return null;
          const varied = picked.with(index, other);
          if ((await attempt(make(varied), true)) !== null) return make(varied);
        }
      }
    }
  }
  return null;
}

function usesOfPosition(values: unknown[], name: string, known: Map<unknown, string>, isVolatile: boolean): string[] {
  const operand = known.get(values[0]);
  if (operand !== undefined && values.every(value => value === values[0])) {
    return isItem(values[0]) ? [`${name} === ${operand}`, `${name}.double()`] : [`${name} === ${operand}`];
  }
  const kinds = new Set(values.map(value => (value === null ? "null" : typeof value)));
  if (isVolatile || kinds.has("function") || kinds.has("symbol")) return [`typeof ${name}`];
  if (kinds.size === 1 && kinds.has("number")) return [`typeof ${name}`, `${name} + 1`];
  if (kinds.size === 1 && kinds.has("string")) return [`typeof ${name}`, `${name}.length`, name];
  if (kinds.size === 1 && kinds.has("undefined")) return [`${name} === undefined`];
  if (values.every(value => typeof value !== "object" || value === null || literalOf(value) !== null))
    return [`typeof ${name}`, name];
  return [`typeof ${name}`];
}

function callbackText(
  name: string,
  records: Recorded[],
  answer: string | null,
  known: Map<unknown, string>,
  isVolatile: boolean,
): string[] {
  const count = Math.min(5, Math.max(0, ...records.map(record => record.passed.length)));
  const names = ordinals.slice(0, count).map(word => `${word}Value`);
  const uses = names.flatMap((each, index) =>
    usesOfPosition(
      records.filter(record => record.passed.length > index).map(record => record.passed[index]),
      each,
      known,
      isVolatile,
    ),
  );
  const selves = records.map(record => record.self);
  const self =
    selves.length === 0
      ? []
      : selves.every(value => value === undefined)
        ? ["this === undefined"]
        : known.has(selves[0]) && selves.every(value => value === selves[0])
          ? [`this === ${known.get(selves[0])}`]
          : ["typeof this"];
  const printed = [JSON.stringify(name), ...uses, ...self, "arguments.length"];
  const text = [`function ${name}(${names.join(", ")}) {`];
  for (let index = 0; index < printed.length; index += 6)
    text.push(`  console.log(${printed.slice(index, index + 6).join(", ")});`);
  if (answer !== null) text.push(`  return ${answer};`);
  text.push("}");
  return text;
}

function knownOperands(written: Written, outcome: Outcome): Map<unknown, string> {
  const known = new Map<unknown, string>();
  if (outcome.item !== undefined) known.set(outcome.item, "item");
  written.names.forEach((name, index) => {
    const value = outcome.operands[index];
    if (name !== null && ((typeof value === "object" && value !== null) || typeof value === "function"))
      known.set(value, name);
  });
  return known;
}

class CannotDescribe extends Error {}

async function describe(
  plan: Plan,
  written: Written,
  outcome: Outcome,
  isVolatile: boolean,
  most = 12,
): Promise<string[]> {
  try {
    return await describeOrThrow(plan, written, outcome, isVolatile, most);
  } catch {
    throw new CannotDescribe();
  }
}

async function describeOrThrow(
  plan: Plan,
  written: Written,
  outcome: Outcome,
  isVolatile: boolean,
  most: number,
): Promise<string[]> {
  const known = knownOperands(written, outcome);
  const walker = new Walker(isVolatile, known, most);
  if (plan.overload.mode === "Set") {
    const target = written.call.slice(0, written.call.lastIndexOf(" = "));
    const name = written.names[0];
    if (name !== null) {
      const read = await evaluate(`return [${target}];`, [name], [outcome.operands[0]]);
      if (!read.failed) await walker.walk((read.value as [unknown])[0], target, 1);
    }
    return [`${written.call};`, ...walker.finish()];
  }
  await walker.walk(outcome.result, "result", 2);
  for (const [index, name] of written.names.entries()) {
    const value = outcome.operands[index];
    if (name === null || typeof value !== "object" || value === null || snapshot(value) === outcome.before[index])
      continue;
    known.delete(value);
    await walker.walk(value, name, 2);
  }
  return [`const result = ${written.call};`, ...walker.finish()];
}

const flavorWords: Record<Flavor, string> = {
  mixed: "and-what-it-answers",
  numbers: "with-text-among-integers",
  empty: "with-nothing-to-work-on",
  items: "with-instances-of-a-class",
};
class Item {
  constructor(public size: number) {}
  double() {
    return this.size * 2;
  }
}

const answers: [string, unknown, string][] = [
  ["{ made: 1.5 }", { made: 1.5 }, "an-object"],
  ["new Item(2.5)", new Item(2.5), "an-instance"],
  ["0", 0, "zero"],
  ['"text"', "text", "text"],
];

const programsOfOneKindForAnOverload = Number(process.env.PROGRAMS_OF_ONE_KIND ?? 2);

class Collection {
  programs: Program[] = [];
  private texts = new Set<string>();
  private names = new Map<string, number>();
  private perOverload = new Map<string, number>();
  overload = "";

  async add(row: Row, words: string, text: string, mustPrint: string[] = []): Promise<boolean> {
    if (this.texts.has(text)) return false;
    const kind = `${this.overload} ${words}`;
    if ((this.perOverload.get(kind) ?? 0) >= programsOfOneKindForAnOverload) return false;
    const output = await printsTheSameTwice(text);
    if (output === null || !mustPrint.every(word => output.some(line => line.includes(word)))) return false;
    if (output.some(line => line.includes("calls++") || line.includes("console.log"))) return false;
    this.texts.add(text);
    this.perOverload.set(kind, (this.perOverload.get(kind) ?? 0) + 1);
    const base = `${wordsOf(row.path)}-${words}`;
    const count = (this.names.get(base) ?? 0) + 1;
    this.names.set(base, count);
    this.programs.push({ name: count === 1 ? base : `${base}-in-form-${count}`, rows: [row.path], text });
    return true;
  }
}

const show = [
  "function show(value) {",
  "  if (Array.isArray(value)) return value.map(show).join();",
  "  return value instanceof Item ? value.double() : typeof value;",
  "}",
];
const showData = (isVolatile: boolean) => [
  "function show(value) {",
  "  if (Array.isArray(value)) return value.map(show).join();",
  isVolatile
    ? "  return typeof value;"
    : '  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;',
  "}",
];
const readersOfData: Record<string, string[]> = {
  list: ["a-loop", "its-indexes", "a-spread", "map", "object-values"],
  object: ["object-values", "object-entries", "a-for-in-loop", "a-spread", "object-assign"],
  map: ["a-loop", "a-spread-of-its-values", "for-each"],
  set: ["a-loop", "a-spread", "for-each"],
};
const each = (list: string) => [`for (const value of ${list}) console.log(show(value));`];

const readersOf: Record<string, [string, string[]][]> = {
  list: [
    ["a-loop", each("held")],
    ["its-indexes", ["for (let index = 0; index < held.length; index++) console.log(show(held[index]));"]],
    ["a-spread", each("[...held]")],
    ["slice", each("held.slice()")],
    ["concat", each("[].concat(held)")],
    ["array-from", each("Array.from(held)")],
    ["map", each("held.map(value => value)")],
    ["filter", each("held.filter(() => true)")],
    ["flat", each("[held].flat()")],
    ["to-sorted", each("held.toSorted(() => 0)")],
    ["object-values", each("Object.values(held)")],
    ["object-entries", ["for (const [key, value] of Object.entries(held)) console.log(key, show(value));"]],
    ["a-set", each("new Set(held)")],
    ["for-each", ["held.forEach(value => console.log(show(value)));"]],
    ["find", ["console.log(show(held.find(value => value instanceof Item)));"]],
    ["pop-and-shift", ["console.log(show(held.pop()), show(held.shift()));"]],
    [
      "a-call-with-a-spread",
      [
        "function use(first, second, third) {",
        "  console.log(show(first), show(second), show(third));",
        "}",
        "use(...held);",
      ],
    ],
  ],
  object: [
    ["object-values", each("Object.values(held)")],
    ["object-entries", ["for (const [key, value] of Object.entries(held)) console.log(key, show(value));"]],
    ["object-keys", ["for (const key of Object.keys(held)) console.log(key, show(held[key]));"]],
    ["a-for-in-loop", ["for (const key in held) console.log(key, show(held[key]));"]],
    ["a-spread", each("Object.values({ ...held })")],
    [
      "object-assign",
      ["const copy = Object.assign({}, held);", "for (const key in copy) console.log(key, show(copy[key]));"],
    ],
    [
      "reflect-own-keys",
      ["for (const key of Reflect.ownKeys(held)) console.log(String(key), show(Reflect.get(held, key)));"],
    ],
    [
      "descriptors",
      [
        "for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(held))) console.log(show(descriptor.value));",
      ],
    ],
    ["a-map-of-its-entries", each("new Map(Object.entries(held)).values()")],
  ],
  map: [
    ["a-loop", ["for (const [key, value] of held) console.log(show(key), show(value));"]],
    ["its-values", each("held.values()")],
    ["a-spread-of-its-values", each("[...held.values()]")],
    ["its-keys", each("held.keys()")],
    ["for-each", ["held.forEach((value, key) => console.log(show(key), show(value)));"]],
    ["array-from", ["for (const [key, value] of Array.from(held)) console.log(show(key), show(value));"]],
    ["a-copy", each("new Map(held).values()")],
  ],
  set: [
    ["a-loop", each("held")],
    ["a-spread", each("[...held]")],
    ["array-from", each("Array.from(held)")],
    ["for-each", ["held.forEach(value => console.log(show(value)));"]],
    ["a-copy", each("new Set(held)")],
    ["a-union", each("held.union(new Set())")],
  ],
  iterator: [
    ["a-loop", each("held")],
    ["a-spread", each("[...held]")],
    ["array-from", each("Array.from(held)")],
    ["to-array", each("held.toArray()")],
    ["next", ["for (let step = held.next(); !step.done; step = held.next()) console.log(show(step.value));"]],
    ["a-mapped-iterator", each("held.map(value => value)")],
    ["a-set", each("new Set(held)")],
  ],
  promise: [
    ["await", ["console.log(show(await held));"]],
    ["then", ["await held.then(value => console.log(show(value)));"]],
    ["promise-all", each("await Promise.all([held])")],
    ["promise-race", ["console.log(show(await Promise.race([held])));"]],
    ["promise-any", ["console.log(show(await Promise.any([held])));"]],
    ["promise-all-settled", ["console.log(show((await Promise.allSettled([held]))[0].value));"]],
    ["finally", ["console.log(show(await held.finally(() => {})));"]],
    ["promise-resolve", ["console.log(show(await Promise.resolve(held)));"]],
    ["an-async-function", ["console.log(show(await (async () => held)()));"]],
  ],
};

function holds(value: unknown, depth: number): boolean {
  if (isItem(value)) return true;
  if (typeof value !== "object" || value === null || depth === 0) return false;
  if (value instanceof Map) return [...value].some(([key, held]) => holds(key, depth - 1) || holds(held, depth - 1));
  if (value instanceof Set) return [...value].some(held => holds(held, depth - 1));
  return !ArrayBuffer.isView(value) && Object.values(value).some(held => holds(held, depth - 1));
}

function kindOfData(result: object): string | null {
  if (Array.isArray(result)) return result.length > 0 ? "list" : null;
  if (result instanceof Map) return result.size > 0 ? "map" : null;
  if (result instanceof Set) return result.size > 0 ? "set" : null;
  if ([Object.prototype, null].includes(Object.getPrototypeOf(result)))
    return Object.keys(result).length > 0 ? "object" : null;
  return null;
}

async function chainPrograms(
  collection: Collection,
  plan: Plan,
  answer: unknown,
  start: string,
  isVolatile: boolean,
): Promise<void> {
  if (plan.overload.mode === "Set") return;
  const outcome = await attempt(plan, answer);
  if (outcome === null) return;
  const { result } = outcome;
  if (typeof result !== "object" || result === null) return;
  let kind: string | null = null;
  if (result instanceof Promise) {
    if (
      isItem(
        await within<unknown>(
          result.catch(() => undefined),
          undefined,
          100,
        ),
      )
    )
      kind = "promise";
  } else if (Array.isArray(result)) kind = holds(result, 2) ? "list" : null;
  else if (result instanceof Map) kind = holds(result, 2) ? "map" : null;
  else if (result instanceof Set) kind = holds(result, 2) ? "set" : null;
  else if (typeof (result as Iterator<unknown>).next === "function" && Symbol.iterator in result) kind = "iterator";
  else if ([Object.prototype, null].includes(Object.getPrototypeOf(result))) kind = holds(result, 2) ? "object" : null;
  if (kind === null) {
    const data = result instanceof Promise ? null : kindOfData(result);
    if (data === null || outcome.operands.includes(result)) return;
    for (const [words, reader] of readersOf[data]) {
      if (readersOfData[data].includes(words))
        await collection.add(plan.row, `and-then-${words}`, lines(start, showData(isVolatile), reader));
    }
    return;
  }
  const setup = start.includes(itemSetup[0]) ? [] : itemSetup;
  for (const [words, reader] of readersOf[kind]) {
    const text = lines(setup, start, show, reader);
    (await collection.add(plan.row, `and-then-${words}`, text, ["3"])) ||
      (await collection.add(plan.row, `and-then-${words}`, text, ["5"]));
  }
}

async function answerPrograms(
  collection: Collection,
  row: Row,
  overload: Overload,
  isVolatile: boolean,
): Promise<Plan[]> {
  const mixed: Plan[] = [];
  for (const flavor of ["mixed", "numbers", "empty", "items"] as const)
    for (const plan of await plansOf(row, overload, flavor)) {
      if (flavor === "mixed") mixed.push(plan);
      const written = write(plan);
      const variants = written.callbacks.length > 0 && flavor === "mixed" ? answers : answers.slice(0, 1);
      for (const [answerText, answer, answerWords] of variants) {
        const outcome = await attempt(plan, answer);
        if (outcome === null) continue;
        const known = knownOperands(written, outcome);
        const ending = await describe(plan, written, outcome, isVolatile).catch(() => null);
        if (ending === null) continue;
        const callbacks = written.callbacks.flatMap((name, index) =>
          callbackText(name, outcome.records[index], answerText, known, isVolatile),
        );
        const setup =
          answerText.includes("Item") && !plan.setup.includes(itemSetup[0])
            ? [...itemSetup, ...plan.setup]
            : plan.setup;
        const text = lines(setup, written.declarations, callbacks, ending);
        if (flavor === "mixed" || flavor === "items") {
          const quiet = written.callbacks.flatMap(name => [`function ${name}() {`, `  return ${answerText};`, "}"]);
          await chainPrograms(
            collection,
            plan,
            answer,
            lines(setup, written.declarations, quiet, `const held = ${written.call};`),
            isVolatile,
          );
        }
        const words =
          written.callbacks.length > 0
            ? `${flavor === "mixed" ? "" : `${flavorWords[flavor]}-`}runs-a-callback-that-returns-${answerWords}`
            : flavorWords[flavor];
        await collection.add(row, words, text);
      }
      if (written.callbacks.length === 0 || flavor !== "mixed") continue;
      recordersStore = true;
      const outcome = await attempt(plan, true);
      const ending = outcome === null ? null : await describe(plan, written, outcome, isVolatile).catch(() => null);
      recordersStore = false;
      if (
        outcome === null ||
        ending === null ||
        !outcome.records.some(list => list.some(record => record.passed.some(isItem)))
      )
        continue;
      const known = knownOperands(written, outcome);
      const callbacks = written.callbacks.flatMap((name, index) => {
        const text = callbackText(name, outcome.records[index], "true", known, isVolatile);
        const count = Math.min(5, Math.max(0, ...outcome.records[index].map(record => record.passed.length)));
        const stores = ordinals
          .slice(0, count)
          .filter((word, position) => outcome.records[index].some(record => isItem(record.passed[position])))
          .map(word => `  if (${word}Value instanceof Item) ${word}Value.size = "changed";`);
        return [text[0], ...stores, ...text.slice(1).filter(line => !line.includes("console.log"))];
      });
      const text = lines(
        plan.setup,
        written.declarations,
        callbacks,
        ending,
        "console.log(typeof item.size, item.size.length, item.double());",
      );
      await collection.add(row, "runs-a-callback-that-stores-into-what-it-is-given", text);
    }
  return mixed;
}

export function logging<T extends object>(base: T, gets: (string | symbol)[]): T {
  return new Proxy(base, {
    get(target, key, receiver) {
      gets.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
}

const operandWords = (index: number) => (index === 0 ? "receiver" : `${ordinals[index - 1] ?? "last"}-argument`);
const keyText = (key: string | symbol) =>
  typeof key === "symbol"
    ? `[${key.description}]`
    : /^[A-Za-z_$][A-Za-z0-9_$]*$|^[0-9]+$/.test(key)
      ? key
      : JSON.stringify(key);
const keyWords = (key: string | symbol) =>
  wordsOf(typeof key === "symbol" ? key.description!.replace("Symbol.", "symbol-") : key);
const superMember = (key: string | symbol) => `super${typeof key === "symbol" ? keyText(key) : `.${key}`}`;
export const prototypeText = (shape: Shape) =>
  `${shape.holder.startsWith("%") ? `Object.getPrototypeOf(${staticHolders[shape.holder] ?? "Object"})` : shape.holder}.prototype${shape.accessor}`;

function conversionProbe(name: string, value: unknown, withToPrimitive: boolean): string[] | null {
  const literal = literalOf(value);
  if (literal === null || typeof value === "object") return null;
  if (withToPrimitive) {
    return [
      `const ${name} = {`,
      "  [Symbol.toPrimitive](hint) {",
      "    calls++;",
      `    console.log("${name} toPrimitive", hint, this === ${name});`,
      `    return ${literal};`,
      "  },",
      "};",
    ];
  }
  return [
    `const ${name} = {`,
    "  valueOf() {",
    "    calls++;",
    `    console.log("${name} valueOf", this === ${name});`,
    `    return ${literal};`,
    "  },",
    "  toString() {",
    "    calls++;",
    `    console.log("${name} toString", this === ${name});`,
    `    return ${JSON.stringify(String(value))};`,
    "  },",
    "};",
  ];
}

export async function readsOf(plan: Plan, index: number, base: object): Promise<(string | symbol)[] | null> {
  const gets: (string | symbol)[] = [];
  const probe = logging(base, gets);
  let written = write(plan, new Map([[index, "probe"]]));
  if (index === 0) {
    const start = written.call.indexOf("(", `probe${plan.shape.accessor}`.length - 1);
    written = {
      ...written,
      call: `Reflect.apply(${prototypeText(plan.shape)}, probe, [${written.call.slice(start + 1, -1)}])`,
    };
  }
  const outcome = await attempt(plan, true, ["probe"], [probe], written, false);
  if (outcome !== null && outcome.result instanceof Promise)
    await within(
      outcome.result.catch(() => {}),
      undefined,
    );
  return outcome === null && gets.length === 0 ? null : gets;
}

const failure = (call: string) => [
  "try {",
  `  ${call};`,
  "} catch (error) {",
  "  console.log(error instanceof TypeError, error instanceof RangeError);",
  "}",
];

function countingThroughThis(probes: string[]): { text: string[]; names: string[] } {
  const names: string[] = [];
  const text = probes.flatMap(line => {
    const head = /^const ([A-Za-z]*[pP]robe) = \{$/.exec(line);
    if (head !== null) {
      names.push(head[1]);
      return [line, "  count: 0,"];
    }
    return line === "    calls++;" ? [line, "    this.count++;"] : [line];
  });
  return { text, names };
}

async function finishProbe(
  collection: Collection,
  plan: Plan,
  isVolatile: boolean,
  words: string,
  replaced: Map<number, string>,
  probes: string[],
  prints: string[],
  receiverMethod: string | null = null,
  answer: [string, unknown] = ["true", true],
): Promise<boolean> {
  const counting = countingThroughThis(probes);
  const tail = `console.log(${["calls", ...counting.names.map(name => `${name}.count`)].join(", ")});`;
  return (
    (await finishProbeWith(
      collection,
      plan,
      isVolatile,
      words,
      replaced,
      counting.text,
      prints,
      receiverMethod,
      tail,
      answer,
    )) ||
    (await finishProbeWith(
      collection,
      plan,
      isVolatile,
      words,
      replaced,
      probes,
      prints,
      receiverMethod,
      "console.log(calls);",
      answer,
    ))
  );
}

async function finishProbeWith(
  collection: Collection,
  plan: Plan,
  isVolatile: boolean,
  words: string,
  replaced: Map<number, string>,
  probes: string[],
  prints: string[],
  receiverMethod: string | null,
  tail: string,
  answer: [string, unknown],
): Promise<boolean> {
  const written = write(plan, replaced, receiverMethod);
  const names = [...replaced.values()];
  const made = await evaluate(
    lines("let calls = 0;", "const console = { log() {} };", plan.setup, probes, `return [${names.join(", ")}];`),
  );
  if (made.failed) return false;
  const outcome = await attempt(plan, answer[1], names, made.value as unknown[], written);
  const ending = outcome === null ? failure(written.call) : await describe(plan, written, outcome, isVolatile, 8);
  const callbacks = written.callbacks.flatMap((name, index) =>
    callbackText(
      name,
      outcome?.records[index] ?? [],
      answer[0],
      outcome === null ? new Map() : knownOperands(written, outcome),
      isVolatile,
    ),
  );
  const text = lines("let calls = 0;", plan.setup, written.declarations, probes, callbacks, ending, tail);
  return collection.add(plan.row, words, text, prints);
}

const methodAnswers = ["undefined", '"made"', "1.5", "{ made: 1.5 }", "null", "[]", "true"];

function methodHookOf(key: string | symbol, answer: string): string[] {
  const label = typeof key === "symbol" ? key.description! : key;
  return [
    `  ${keyText(key)}(...passed) {`,
    "    calls++;",
    `    console.log("called ${label}", passed.length, passed.map(each => typeof each).join(), this === probe);`,
    `    return ${answer};`,
    "  },",
  ];
}

const hasHookOfItsOwn = (key: string | symbol) =>
  ["toJSON", "then", "valueOf", "toString"].includes(key as string) || key === Symbol.toPrimitive;

async function namedHooks(
  keys: (string | symbol)[],
  where: string,
  finish: (words: string, hook: string[], prints: string[]) => Promise<boolean>,
): Promise<void> {
  for (const key of keys) {
    const label = typeof key === "symbol" ? key.description! : key;
    await finish(`reads-${keyWords(key)}-of-${where}`, hookOf(key), [label]);
    if (hasHookOfItsOwn(key)) continue;
    for (const answer of methodAnswers) {
      if (await finish(`calls-${keyWords(key)}-of-${where}`, methodHookOf(key, answer), [`called ${label}`])) break;
    }
  }
}

function hookOf(key: string | symbol): string[] {
  const label = typeof key === "symbol" ? key.description! : key;
  if (key === "toJSON") {
    return [
      "  toJSON(key) {",
      "    calls++;",
      '    console.log("toJSON", typeof key, this === probe);',
      "    return { made: 1.5 };",
      "  },",
    ];
  }
  if (key === "then") {
    return [
      "  then(resolve, reject) {",
      "    calls++;",
      '    console.log("then", typeof resolve, typeof reject, this === probe);',
      "    resolve(2.5);",
      "  },",
    ];
  }
  if (key === Symbol.toPrimitive) {
    return [
      "  [Symbol.toPrimitive](hint) {",
      "    calls++;",
      '    console.log("Symbol.toPrimitive", hint, this === probe);',
      '    return "first";',
      "  },",
    ];
  }
  if (key === "valueOf" || key === "toString") {
    return [
      `  ${key}() {`,
      "    calls++;",
      `    console.log("${key}", this === probe);`,
      '    return "first";',
      "  },",
    ];
  }
  return [
    `  get ${keyText(key)}() {`,
    "    calls++;",
    `    console.log("${label}", this === probe);`,
    "    return undefined;",
    "  },",
  ];
}

async function hookPrograms(collection: Collection, plan: Plan, isVolatile: boolean): Promise<void> {
  const operands: (Candidate | null)[] = [plan.receiver, ...plan.passed];
  const converted: number[] = [];
  const values: unknown[] = [];
  for (const [index, candidate] of operands.entries()) {
    if (candidate === null || candidate.isFunction) continue;
    if (index === 0 && (plan.overload.mode !== "Call" || !plan.shape.isOnPrototype)) continue;
    const evaluation = await evaluate(lines(plan.setup, `return [${candidate.text}];`));
    if (evaluation.failed) continue;
    const value = (evaluation.value as [unknown])[0];
    values[index] = value;
    const isPrimitive = typeof value !== "object" || value === null;
    const isPlain = Array.isArray(value) || (!isPrimitive && Object.getPrototypeOf(value) === Object.prototype);
    if (
      !isPrimitive &&
      !isPlain &&
      typeof (value as Iterator<unknown>).next === "function" &&
      Symbol.iterator in (value as object)
    ) {
      const items = literalOf([...(value as Iterable<unknown>)].slice(0, 4));
      if (items === null) continue;
      for (const [answer, more] of [
        [["true", true], ""],
        [["0", 0], "-and-a-callback-that-returns-zero"],
      ] as [[string, unknown], string][])
        await finishProbe(
          collection,
          plan,
          isVolatile,
          `runs-next-of-a-plain-object-that-is-its-${operandWords(index)}${more}`,
          new Map([[index, "probe"]]),
          [
            "const probe = {",
            ...(index === 0 ? [`  work: ${prototypeText(plan.shape)},`] : []),
            "  index: 0,",
            `  items: ${items},`,
            "  next() {",
            "    calls++;",
            '    console.log("next", this === probe, arguments.length);',
            "    return this.index < this.items.length ? { done: false, value: this.items[this.index++] } : { done: true, value: undefined };",
            "  },",
            "  return() {",
            "    calls++;",
            '    console.log("return", this === probe);',
            "    return {};",
            "  },",
            "};",
          ],
          ["next"],
          index === 0 ? ".work" : null,
          answer,
        );
      continue;
    }
    if (!isPrimitive && !isPlain) continue;
    if (typeof value === "symbol") continue;
    const copy = ((await evaluate(lines(plan.setup, `return [${candidate.text}];`))).value as [unknown])[0];
    const base: object = isPrimitive ? { valueOf: () => value, toString: () => String(value) } : (copy as object);
    const reads = await readsOf(plan, index, base);
    if (reads === null) continue;
    const keys = [...new Set(reads)];
    const method = index === 0 ? ".work" : null;
    const work = index === 0 ? [`  work: ${prototypeText(plan.shape)},`] : [];
    const where = operandWords(index);
    const replaced = new Map([[index, "probe"]]);
    const finish = (words: string, probes: string[], prints: string[]) =>
      finishProbe(collection, plan, isVolatile, words, replaced, probes, prints, method);
    if (isPrimitive) {
      if (!keys.includes(Symbol.toPrimitive)) continue;
      if (index > 0) {
        converted.push(index);
        continue;
      }
      for (const withToPrimitive of [false, true]) {
        const probe = conversionProbe("probe", value, withToPrimitive);
        if (probe === null) continue;
        const words = `converts-its-receiver-with-${withToPrimitive ? "symbol-to-primitive" : "value-of-or-to-string"}`;
        await finish(words, [probe[0], ...work, ...probe.slice(1)], ["probe "]);
      }
      continue;
    }
    if (Array.isArray(value)) {
      const elements = value.map(each => literalOf(each));
      if (elements.includes(null)) continue;
      if (keys.includes(Symbol.iterator)) {
        await finish(
          `iterates-its-${where}`,
          [
            `const items = ${candidate.text};`,
            "const probe = {",
            ...work,
            "  [Symbol.iterator]() {",
            "    calls++;",
            '    console.log("iterator", this === probe);',
            "    return {",
            "      index: 0,",
            "      next() {",
            "        calls++;",
            '        console.log("next", arguments.length);',
            "        return this.index < items.length ? { done: false, value: items[this.index++] } : { done: true, value: undefined };",
            "      },",
            "      return() {",
            "        calls++;",
            '        console.log("return");',
            "        return {};",
            "      },",
            "    };",
            "  },",
            "};",
          ],
          ["iterator", "next"],
        );
      }
      if (keys.includes("length")) {
        await finish(
          `reads-the-length-and-the-elements-of-its-${where}-through-getters`,
          [
            "const probe = {",
            ...work,
            "  get length() {",
            "    calls++;",
            '    console.log("length");',
            `    return ${value.length};`,
            "  },",
            ...elements.flatMap((element, position) => [
              `  get ${position}() {`,
              "    calls++;",
              `    console.log("element ${position}");`,
              `    return ${element};`,
              "  },",
            ]),
            "};",
          ],
          ["length"],
        );
        await finish(
          `reads-and-stores-the-length-of-its-${where}-through-accessors`,
          [
            "const probe = {",
            ...work,
            "  get length() {",
            "    calls++;",
            '    console.log("length");',
            `    return ${value.length};`,
            "  },",
            "  set length(value) {",
            "    calls++;",
            '    console.log("store to length", typeof value, value);',
            "  },",
            ...elements.map((element, position) => `  ${position}: ${element},`),
            "};",
          ],
          ["store to length"],
        );
      }
      continue;
    }
    const entries = Object.entries(value as object);
    if (entries.some(([, each]) => literalOf(each) === null)) continue;
    if (entries.some(([key]) => keys.includes(key))) {
      await finish(
        `reads-the-members-of-its-${where}-through-getters`,
        [
          "const probe = {",
          ...work,
          ...entries.flatMap(([key, each]) => [
            `  get ${keyText(key)}() {`,
            "    calls++;",
            `    console.log("getter ${key}", this === probe);`,
            `    return ${literalOf(each)};`,
            "  },",
          ]),
          "};",
        ],
        ["getter "],
      );
    }
    const members = entries.map(([name, each]) => `  ${keyText(name)}: ${literalOf(each)},`);
    await namedHooks(
      keys.filter(key => !Object.hasOwn(value as object, key)),
      `its-${where}`,
      (words, hook, prints) => finish(words, ["const probe = {", ...work, ...members, ...hook, "};"], prints),
    );
  }
  if (converted.length === 0) return;
  for (const withToPrimitive of [false, true]) {
    const replaced = new Map<number, string>();
    const probes: string[] = [];
    for (const index of converted) {
      const name = converted.length === 1 ? "probe" : `${ordinals[index - 1] ?? `operand${index}`}Probe`;
      const probe = conversionProbe(name, values[index], withToPrimitive);
      if (probe === null) continue;
      replaced.set(index, name);
      probes.push(...probe);
    }
    if (replaced.size === 0) continue;
    const words = `converts-its-arguments-with-${withToPrimitive ? "symbol-to-primitive" : "value-of-or-to-string"}`;
    await finishProbe(collection, plan, isVolatile, words, replaced, probes, [
      withToPrimitive ? "toPrimitive" : "robe ",
    ]);
  }
}

async function contentPrograms(collection: Collection, plan: Plan, isVolatile: boolean): Promise<void> {
  const operands: (Candidate | null)[] = [plan.receiver, ...plan.passed];
  for (const [index, candidate] of operands.entries()) {
    if (candidate === null || candidate.isFunction || !/^[[{]/.test(candidate.text)) continue;
    const evaluation = await evaluate(lines(plan.setup, `return [${candidate.text}];`));
    if (evaluation.failed) continue;
    const value = (evaluation.value as [unknown])[0];
    const places: [string, string][] = [];
    if (Array.isArray(value)) {
      const rest = value.slice(1).map(each => literalOf(each));
      if (rest.includes(null)) continue;
      places.push(["an-element", `[${["probe", ...rest].join(", ")}]`]);
      const entry = value[0];
      if (Array.isArray(entry) && entry.length === 2) {
        places.push(["a-key", `[${[`[probe, ${literalOf(entry[1])}]`, ...rest].join(", ")}]`]);
        places.push(["a-value", `[${[`[${literalOf(entry[0])}, probe]`, ...rest].join(", ")}]`]);
      }
    } else {
      const entries = Object.entries(value as object);
      if (entries.length === 0 || entries.some(([, each]) => literalOf(each) === null)) continue;
      places.push([
        "a-member",
        `{ ${entries.map(([key, each], position) => `${keyText(key)}: ${position === 0 ? "probe" : literalOf(each)}`).join(", ")} }`,
      ]);
    }
    const replaced = new Map([[index, "holder"]]);
    for (const [place, holderText] of places) {
      const gets: (string | symbol)[] = [];
      const holder = await evaluate(lines(plan.setup, `return [${holderText}];`), ["probe"], [logging({}, gets)]);
      if (holder.failed) continue;
      const outcome = await attempt(plan, true, ["holder"], holder.value as unknown[], write(plan, replaced), false);
      if (outcome !== null && outcome.result instanceof Promise)
        await within(
          outcome.result.catch(() => {}),
          undefined,
        );
      await namedHooks([...new Set(gets)], `${place}-of-its-${operandWords(index)}`, (words, hook, prints) =>
        finishProbe(
          collection,
          plan,
          isVolatile,
          words,
          replaced,
          ["const probe = {", ...hook, "};", `const holder = ${holderText};`],
          prints,
        ),
      );
    }
  }
}

function countingMembers(members: string[], instance: string): { members: string[]; count: string } | null {
  if (members[0].startsWith("  constructor")) return null;
  const isStatic = members[0].startsWith("  static");
  return {
    members: [
      isStatic ? "  static count = 0;" : "  count = 0;",
      ...members.flatMap(line => (line === "    calls++;" ? [line, "    this.count++;"] : [line])),
    ],
    count: `${isStatic ? "Special" : instance}.count`,
  };
}

export function chainLogging(base: Function, gets: (string | symbol)[], statics: (string | symbol)[]): Function {
  const Special = class extends (base as new (...passed: unknown[]) => object) {};
  const logged = (target: object, log: (string | symbol)[]) =>
    new Proxy(target, {
      get(holder, key, receiver) {
        log.push(key);
        return Reflect.get(holder, key, receiver);
      },
    });
  Object.setPrototypeOf(Special.prototype, logged(base.prototype, gets));
  Object.defineProperty(Special.prototype, "constructor", {
    configurable: true,
    get() {
      gets.push("constructor");
      return Special;
    },
  });
  Object.setPrototypeOf(Special, logged(base, statics));
  return Special;
}

function inheritedDescriptor(holder: object | null, key: string | symbol): PropertyDescriptor | undefined {
  for (; holder !== null; holder = Object.getPrototypeOf(holder)) {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (descriptor !== undefined) return descriptor;
  }
  return undefined;
}

async function subclassPrograms(collection: Collection, plan: Plan, isVolatile: boolean): Promise<void> {
  const operands: (Candidate | null)[] = [plan.receiver, ...plan.passed];
  for (const [index, candidate] of operands.entries()) {
    const sample = candidate?.class === undefined ? undefined : classSamples[candidate.class];
    if (candidate === null || sample === undefined || sample.base === "" || candidate.text !== sample.make(sample.base))
      continue;
    const base = (await evaluate(lines(plan.setup, `return ${sample.base};`))).value as Function;
    if (typeof base !== "function") continue;
    const gets: (string | symbol)[] = [];
    const statics: (string | symbol)[] = [];
    const instance = await evaluate(
      lines(plan.setup, `return [${sample.make("Special")}];`),
      ["Special"],
      [chainLogging(base, gets, statics)],
    );
    if (instance.failed) continue;
    gets.length = 0;
    statics.length = 0;
    const written = write(plan, new Map([[index, "special"]]));
    const outcome = await attempt(plan, true, ["special"], instance.value as unknown[], written, false);
    if (outcome !== null && outcome.result instanceof Promise)
      await within(
        outcome.result.catch(() => {}),
        undefined,
      );
    const called = plan.shape.accessor.replace(/^\./, "");
    if (index === 0 && gets.length > 0 && keyText(gets[0]) === called) gets.shift();
    const where = index === 0 ? "a-subclass" : `a-subclass-given-as-its-${operandWords(index)}`;
    const emit = async (words: string, members: string[], label: string) => {
      const counting = countingMembers(members, "special");
      if (
        counting !== null &&
        (await emitWith(words, counting.members, label, `console.log(calls, ${counting.count});`))
      )
        return;
      await emitWith(words, members, label, "console.log(calls);");
    };
    const emitWith = async (words: string, members: string[], label: string, tail: string): Promise<boolean> => {
      const text = [
        `class Special extends ${sample.base} {`,
        ...members,
        "}",
        `const special = ${sample.make("Special")};`,
      ];
      const made = await evaluate(
        lines("let calls = 0;", "const console = { log() {} };", plan.setup, text, "return [special];"),
      );
      if (made.failed) return false;
      const again = await attempt(plan, true, ["special"], made.value as unknown[], written);
      const ending = again === null ? failure(written.call) : await describe(plan, written, again, isVolatile, 8);
      const callbacks = written.callbacks.flatMap((name, position) =>
        callbackText(
          name,
          again?.records[position] ?? [],
          "true",
          again === null ? new Map() : knownOperands(written, again),
          isVolatile,
        ),
      );
      const whole = lines(
        "let calls = 0;",
        plan.setup,
        written.declarations,
        text,
        callbacks,
        'console.log("made");',
        ending,
        tail,
      );
      return collection.add(plan.row, words, whole, [label]);
    };
    for (const key of new Set(gets)) {
      const label = typeof key === "symbol" ? key.description! : key;
      const descriptor = inheritedDescriptor(base.prototype, key);
      if (key === "constructor") {
        await emit(
          `reads-the-constructor-getter-of-${where}`,
          [
            "  get constructor() {",
            "    calls++;",
            '    console.log("constructor", this === special);',
            "    return Special;",
            "  }",
          ],
          "constructor",
        );
      } else if (typeof descriptor?.value === "function") {
        const names = ordinals
          .slice(0, Math.min(Math.max(descriptor.value.length, 1) + 1, 4))
          .map(word => `${word}Value`);
        await emit(
          `runs-the-overridden-${keyWords(key)}-of-${where}`,
          [
            `  ${keyText(key)}(${names.join(", ")}) {`,
            "    calls++;",
            `    console.log("${label}", arguments.length, ${names.map(name => `typeof ${name}`).join(", ")});`,
            `    return ${superMember(key)}(...arguments);`,
            "  }",
          ],
          label,
        );
      } else if (descriptor?.get !== undefined) {
        await emit(
          `reads-the-overridden-${keyWords(key)}-getter-of-${where}`,
          [
            `  get ${keyText(key)}() {`,
            "    calls++;",
            `    console.log("${label}");`,
            `    return ${superMember(key)};`,
            "  }",
          ],
          label,
        );
      } else if (descriptor === undefined) {
        await emit(
          `reads-the-${keyWords(key)}-getter-of-${where}`,
          [`  get ${keyText(key)}() {`, "    calls++;", `    console.log("${label}");`, "    return undefined;", "  }"],
          label,
        );
      }
    }
    for (const key of new Set(statics)) {
      const label = typeof key === "symbol" ? key.description! : key;
      if (key === Symbol.species) {
        await emit(
          `reads-the-species-getter-of-${where}`,
          [
            "  static get [Symbol.species]() {",
            "    calls++;",
            '    console.log("Symbol.species", this === Special);',
            `    return ${sample.base};`,
            "  }",
          ],
          "Symbol.species",
        );
        await emit(
          `makes-its-answer-with-the-constructor-of-${where}`,
          [
            "  constructor(...passed) {",
            "    super(...passed);",
            "    calls++;",
            '    console.log("constructor", passed.length, typeof passed[0], new.target === Special);',
            "  }",
          ],
          "constructor",
        );
      } else if (
        key !== "prototype" &&
        typeof (base as unknown as Record<string | symbol, unknown>)[key] === "function"
      ) {
        await emit(
          `runs-the-overridden-static-${keyWords(key)}-of-${where}`,
          [
            `  static ${keyText(key)}(firstValue) {`,
            "    calls++;",
            `    console.log("static ${label}", arguments.length, typeof firstValue, this === Special);`,
            `    return ${superMember(key)}(...arguments);`,
            "  }",
          ],
          `static ${label}`,
        );
      }
    }
  }
}

function overrideOf(base: Function, key: string | symbol): { words: string; members: string[]; label: string } | null {
  const label = typeof key === "symbol" ? key.description! : key;
  const descriptor = inheritedDescriptor(base.prototype, key);
  if (key === "constructor") return null;
  if (typeof descriptor?.value === "function") {
    const names = ordinals.slice(0, Math.min(Math.max(descriptor.value.length, 1) + 1, 4)).map(word => `${word}Value`);
    return {
      words: `runs-the-overridden-${keyWords(key)}`,
      members: [
        `  ${keyText(key)}(${names.join(", ")}) {`,
        "    calls++;",
        `    console.log("${label}", arguments.length, ${names.map(name => `typeof ${name}`).join(", ")});`,
        `    return ${superMember(key)}(...arguments);`,
        "  }",
      ],
      label,
    };
  }
  if (descriptor?.get !== undefined) {
    return {
      words: `reads-the-overridden-${keyWords(key)}-getter`,
      members: [
        `  get ${keyText(key)}() {`,
        "    calls++;",
        `    console.log("${label}");`,
        `    return ${superMember(key)};`,
        "  }",
      ],
      label,
    };
  }
  if (descriptor !== undefined) return null;
  return {
    words: `reads-the-${keyWords(key)}-getter`,
    members: [
      `  get ${keyText(key)}() {`,
      "    calls++;",
      `    console.log("${label}");`,
      "    return undefined;",
      "  }",
    ],
    label,
  };
}

async function holderSubclassPrograms(collection: Collection, plan: Plan, isVolatile: boolean): Promise<void> {
  if (plan.shape.isOnPrototype || plan.overload.mode === "Get" || plan.overload.mode === "Set") return;
  const isConstruction = plan.overload.mode === "Construct";
  if (!isConstruction && plan.shape.holder === "") return;
  const baseText = isConstruction ? plan.row.path : (staticHolders[plan.shape.holder] ?? plan.shape.holder);
  const evaluation = await evaluate(`return ${baseText};`);
  const base = evaluation.value as Function;
  if (evaluation.failed || typeof base !== "function" || typeof base.prototype !== "object" || base.prototype === null)
    return;
  const gets: (string | symbol)[] = [];
  const statics: (string | symbol)[] = [];
  const written = write(plan, new Map(), null, "Special");
  let Special: Function;
  try {
    Special = chainLogging(base, gets, statics);
  } catch {
    return;
  }
  const outcome = await attempt(plan, true, ["Special"], [Special], written, false);
  if (outcome === null) return;
  if (outcome.result instanceof Promise)
    await within(
      outcome.result.catch(() => {}),
      undefined,
    );
  const called = plan.shape.accessor.replace(/^\./, "");
  if (!isConstruction && statics.length > 0 && keyText(statics[0]) === called) statics.shift();
  const emit = async (words: string, members: string[], label: string) => {
    const counting = countingMembers(members, "result");
    if (counting !== null && (await emitWith(words, counting.members, label, counting.count))) return;
    await emitWith(words, members, label, null);
  };
  const emitWith = async (words: string, members: string[], label: string, count: string | null): Promise<boolean> => {
    const text = [`class Special extends ${baseText} {`, ...members, "}"];
    const made = await evaluate(lines("let calls = 0;", "const console = { log() {} };", text, "return [Special];"));
    if (made.failed) return false;
    const again = await attempt(plan, true, ["Special"], made.value as unknown[], written);
    const ending = again === null ? failure(written.call) : await describe(plan, written, again, isVolatile, 8);
    const callbacks = written.callbacks.flatMap((name, position) =>
      callbackText(
        name,
        again?.records[position] ?? [],
        "true",
        again === null ? new Map() : knownOperands(written, again),
        isVolatile,
      ),
    );
    if (again === null && count === "result.count") return false;
    const tail = ["result instanceof Special", "calls", ...(count === null ? [] : [count])].slice(
      again === null ? 1 : 0,
    );
    const whole = lines(
      "let calls = 0;",
      plan.setup,
      written.declarations,
      text,
      callbacks,
      ending,
      `console.log(${tail.join(", ")});`,
    );
    return collection.add(plan.row, words, whole, [label]);
  };
  const of = isConstruction ? "while-it-constructs-a-subclass" : "called-on-a-subclass";
  for (const key of new Set(gets)) {
    const override = overrideOf(base, key);
    if (override !== null) await emit(`${override.words}-${of}`, override.members, override.label);
  }
  if (!isConstruction) {
    await emit(
      `runs-the-constructor-of-the-subclass-it-is-called-on`,
      [
        "  constructor(...passed) {",
        "    super(...passed);",
        "    calls++;",
        '    console.log("constructor", passed.length, typeof passed[0], new.target === Special);',
        "  }",
      ],
      "constructor",
    );
  }
  for (const key of new Set(statics)) {
    const label = typeof key === "symbol" ? key.description! : key;
    if (key === "prototype") continue;
    if (typeof (base as unknown as Record<string | symbol, unknown>)[key] === "function") {
      await emit(
        `runs-the-overridden-static-${keyWords(key)}-${of}`,
        [
          `  static ${keyText(key)}(firstValue) {`,
          "    calls++;",
          `    console.log("static ${label}", arguments.length, typeof firstValue, this === Special);`,
          `    return ${superMember(key)}(...arguments);`,
          "  }",
        ],
        `static ${label}`,
      );
    } else if (key === Symbol.species) {
      await emit(
        `reads-the-species-getter-${of}`,
        [
          "  static get [Symbol.species]() {",
          "    calls++;",
          '    console.log("Symbol.species", this === Special);',
          `    return ${baseText};`,
          "  }",
        ],
        "Symbol.species",
      );
    }
  }
}

export const withoutProgram = new Map<string, string>();

/**
 * The rows of the table that get programs, by the words with which the names of their programs begin. What is written for one group hangs on no other group,
 * so whoever wants the programs of a few rows writes those alone.
 */
export function groupsOfRows(described: Row[]): Map<string, Row[]> {
  const only = process.env.ONLY_ROWS === undefined ? null : new RegExp(process.env.ONLY_ROWS);
  const groups = new Map<string, Row[]>();
  for (const row of described) {
    if (only !== null && !only.test(row.path)) continue;
    if (matches(neverEvaluated, row.path)) {
      withoutProgram.set(row.path, "not called while the programs are written");
      continue;
    }
    const words = wordsOf(row.path);
    const rows = groups.get(words);
    if (rows === undefined) groups.set(words, [row]);
    else rows.push(row);
  }
  return groups;
}

/** The programs of each group. `audited`: what a built-in does while its programs are written is held against its row in that table, for `doubts` in audit.ts. */
export async function tablePrograms(groups: Map<string, Row[]>, audited: Table | null): Promise<Map<string, Program[]>> {
  const programs = new Map<string, Program[]>();
  for (const [words, rows] of groups) {
    const collection = new Collection();
    for (const row of rows) {
      const isVolatile = matches(volatileRows, row.path);
      const before = collection.programs.length;
      for (const overload of row.trusted) {
        if (overload.mode === "Set" && !shapeOf(row.path).isOnPrototype) continue;
        collection.overload = overload.token;
        if (audited !== null && process.env.ONLY_DOUBTS !== undefined) {
          for (const flavor of ["mixed", "items"] as const)
            for (const plan of await plansOf(row, overload, flavor)) await auditPlan(plan, audited);
          continue;
        }
        for (const plan of await answerPrograms(collection, row, overload, isVolatile)) {
          if (audited !== null) await auditPlan(plan, audited);
          for (const write of [hookPrograms, contentPrograms, subclassPrograms, holderSubclassPrograms]) {
            try {
              await write(collection, plan, isVolatile);
            } catch (error) {
              if (!(error instanceof CannotDescribe)) throw error;
            }
          }
        }
      }
      if (collection.programs.length === before)
        withoutProgram.set(row.path, "no call of it with sample operands succeeds");
    }
    programs.set(words, collection.programs);
  }
  return programs;
}
