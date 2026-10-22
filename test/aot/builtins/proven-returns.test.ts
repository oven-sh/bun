import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { loadClassDefinitions } from "../../../src/codegen/builtins/collect-classes";
import type { DumpedClass, DumpedEntry, DumpedParameter, DumpedType, Primitive } from "../../../src/codegen/builtins/dump";
import { declaredTypeOf, isCheckedAtRuntime, parseDeclaredType } from "../../../src/codegen/class-definitions";
import { test } from "../supported";

const typeScriptNames: Record<Primitive, string> = {
  Undefined: "undefined",
  Null: "null",
  Boolean: "boolean",
  Number: "number",
  String: "string",
  Symbol: "symbol",
  BigInt: "bigint",
  NotPassed: "undefined",
};

const table = aotBuiltinEntries();
const entriesByToken = new Map(table.entries.map(entry => [entry.token, entry]));
const classesByToken = new Map(table.classes.map(builtinClass => [builtinClass.token, builtinClass]));
const classesByPrototype = new Map(table.classes.flatMap(builtinClass => (builtinClass.prototype === null ? [] : [[builtinClass.prototype, builtinClass] as const])));

// No program can name a class whose path is written between percent signs, so bun-types says nothing about it.
const hasPublicPath = (entry: DumpedEntry) => !entry.path.includes("%");

// "node:module.SourceMap" is an export of a module, any other path starts at a global.
const typeOfValueAt = (path: string) => `typeof ${path.replace(/^(\w+:[^.]+)\./, 'import("$1").')}`;

function instanceTypeOf(builtinClass: DumpedClass | undefined): string | undefined {
  const classConstructor = builtinClass?.constructor ? entriesByToken.get(builtinClass.constructor) : undefined;
  return classConstructor === undefined || !hasPublicPath(classConstructor) ? undefined : `InstanceType<${typeOfValueAt(classConstructor.path)}>`;
}

function holderTypeOf(entry: DumpedEntry): string | undefined {
  const holder = entry.holder === null ? undefined : entriesByToken.get(entry.holder);
  if (holder === undefined) return undefined;
  if (holder.kind === "Prototype") return instanceTypeOf(classesByPrototype.get(holder.token));
  return hasPublicPath(holder) ? `(${typeOfValueAt(holder.path)})` : undefined;
}

// An operand that is handed back is whatever the call takes for it.
function typeScriptOfPart(part: DumpedType["parts"][number], receiverType: string | undefined, parameters: readonly DumpedParameter[]): string | undefined {
  if (part.part === "Instance") return instanceTypeOf(classesByToken.get(part.class)) ?? "object";
  if (part.part !== "Operand") return undefined;
  if (part.operand === "this") return receiverType;
  const parameter = parameters.find(({ operand }) => Bun.deepEquals(operand, part.operand));
  return parameter === undefined ? undefined : parameter.accepted.isAnything ? "unknown" : typeScriptOf(parameter.accepted, receiverType, []);
}

function typeScriptOf(type: DumpedType, receiverType: string | undefined, parameters: readonly DumpedParameter[]): string | undefined {
  if (type.hasAnyFunction || type.hasPlainData) return undefined;
  const names = new Set<string | undefined>(type.primitives.map(primitive => typeScriptNames[primitive]));
  if (type.hasAnyObject) names.add("object");
  if (type.integers !== null) names.add(typeScriptNames.Number);
  for (const literal of type.stringLiterals) names.add(JSON.stringify(literal));
  for (const part of type.parts) names.add(typeScriptOfPart(part, receiverType, parameters));
  return names.has(undefined) ? undefined : [...names].join(" | ");
}

const described = table.entries
  .filter(entry => entry.origin === "Host")
  .flatMap(entry => entry.overloads.map(overload => ({ ...overload, name: entry.name, isSymbolName: entry.isSymbolName, holderType: holderTypeOf(entry) })))
  .filter(o => o.isProvenByConstruction && !o.result.type.isAnything && o.receiver !== null && (o.mode === "Get" || o.mode === "Call"))
  .map(o => ({ ...o, resultType: typeScriptOf(o.result.type, o.holderType, o.parameters) }));
// What holds a member of a class without a public name to its type is the proof or the check where the value leaves native code.
const named = described.filter(o => o.holderType !== undefined);
const overloads = named.filter(o => !o.isSymbolName);

const lines = overloads.map((overload, index) => {
  const member = `Member<${overload.holderType}, ${JSON.stringify(overload.name)}>`;
  return `export const declaration${index}: Agree<${overload.mode === "Get" ? member : `ReturnType<${member}>`}, ${overload.resultType}> = true;`;
});

test("a result type that is proven by construction agrees with bun-types", async () => {
  expect(described.filter(o => o.holderType === undefined && !o.path.includes("%")).map(o => o.path)).toEqual([]);
  expect(named.filter(o => o.resultType === undefined).map(o => o.path)).toEqual([]);
  expect(overloads.length).toBeGreaterThan(20);
  for (const path of ["Request.prototype.url", "Buffer.prototype.readInt8", "Bun.CryptoHasher.algorithms"]) expect(overloads.map(o => o.path)).toContain(path);
  expect((await errorsOf(lines)).map(line => overloads[line - 2].path)).toEqual([]);
});

test("a definition that disagrees is reported", async () => {
  expect(await errorsOf(['export const Request_url: Agree<Request["url"], number> = true;'])).toEqual([2]);
});

// Blob::from_js also accepts a BuildArtifact, which is not a JSBlob. The first member whose Rust type is to prove Blob needs a test here that hands it one.
test("no Rust type proves Blob", () => {
  const proven = loadClassDefinitions(join(import.meta.dir, "../../..")).flatMap(({ name, proto, klass }) =>
    [...Object.entries(proto), ...Object.entries(klass)].flatMap(([member, field]) => {
      const type = declaredTypeOf(field);
      const declaresBlob = type !== undefined && parseDeclaredType(type).some(alternative => typeof alternative === "object" && alternative.instance === "Blob");
      return declaresBlob && !isCheckedAtRuntime(field) ? [`${name}.${member}`] : [];
    }),
  );
  expect(proven).toEqual([]);
});

async function errorsOf(lines: string[]) {
  using dir = tempDir("proven-returns", {
    // bun-types leaves some members out, and `void` tells the caller not to look at the result: there is nothing to agree with then.
    "agree.ts":
      [
        "type Agree<Declared, Defined> = [void] extends [Declared] ? true : [Declared] extends [Defined] ? true : [Defined] extends [Declared] ? true : false; type Member<Holder, Name> = Name extends keyof Holder ? Holder[Name] : never;",
        ...lines,
      ].join("\n") + "\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "esnext",
        module: "preserve",
        moduleResolution: "bundler",
        skipLibCheck: true,
        typeRoots: [join(import.meta.dir, "../../../packages")],
        types: ["bun-types"],
      },
    }),
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "check"], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return [...(stdout + stderr).matchAll(/(agree\.ts)[":( ]+(?:line=")?(\d+)/g)].map(match => Number(match[2]));
}

const primitivesOfAlternative: Record<string, Primitive> = { string: "String", number: "Number", int32: "Number", bigint: "BigInt", boolean: "Boolean", undefined: "Undefined", null: "Null" };

// An instance of a class is one of every class that its class extends: an S3File is a Blob.
function isInstanceOfOneOf(token: string, classes: Set<string>): boolean {
  for (let builtinClass = classesByToken.get(token); builtinClass; builtinClass = builtinClass.parent === null ? undefined : classesByToken.get(builtinClass.parent)) {
    if (classes.has(builtinClass.token)) return true;
  }
  return classes.has(token);
}

// What a type of the table admits and a declared type does not.
function partsOutside(type: DumpedType, declared: string): string[] {
  const alternatives = parseDeclaredType(declared);
  const primitives = new Set(alternatives.flatMap(alternative => (typeof alternative === "string" ? (primitivesOfAlternative[alternative] ?? []) : [])));
  const instances = new Set(alternatives.flatMap(alternative => (typeof alternative === "object" ? alternative.instance : alternative === "Promise" ? alternative : [])));
  const admitsEveryObject = alternatives.includes("object");
  const outside: string[] = type.primitives.filter(primitive => !primitives.has(primitive));
  if (type.isAnything) outside.push("anything");
  if (type.integers !== null && !primitives.has("Number")) outside.push("integers");
  if (type.stringLiterals.length > 0 && !primitives.has("String")) outside.push("strings");
  if ((type.hasAnyObject || type.hasAnyFunction || type.hasPlainData) && !admitsEveryObject) outside.push("any object");
  for (const part of type.parts) {
    if (part.part === "Operand" && part.operand === "this" && alternatives.includes("this")) continue;
    if (part.part === "Instance" && (admitsEveryObject || isInstanceOfOneOf(part.class, instances))) continue;
    outside.push(part.part === "Instance" ? part.class : part.part);
  }
  return outside;
}

// The class definition is the one source of what a member returns. A row that is written by hand for some operands may say more, never something else.
test("a result that is written by hand lies inside the type that the class definition declares", () => {
  const definitions = new Map(loadClassDefinitions(join(import.meta.dir, "../../..")).map(definition => [definition.name, definition]));
  const classesByConstructor = new Map(table.classes.flatMap(builtinClass => (builtinClass.constructor === null ? [] : [[builtinClass.constructor, builtinClass] as const])));
  let compared = 0;
  const disagreements = table.entries.flatMap(entry => {
    if (entry.holder === null) return [];
    const ofPrototype = classesByPrototype.get(entry.holder);
    const definition = definitions.get((ofPrototype ?? classesByConstructor.get(entry.holder))?.token ?? "");
    const field = (ofPrototype ? definition?.proto : definition?.klass)?.[entry.name];
    const declared = field && declaredTypeOf(field);
    if (!declared) return [];
    return entry.overloads.flatMap(overload => {
      if (overload.isProvenByConstruction || overload.isUndeclared || (overload.mode !== "Call" && overload.mode !== "Get")) return [];
      compared++;
      const outside = partsOutside(overload.result.type, declared);
      return outside.length === 0 ? [] : [`${entry.path}: ${declared} admits no ${outside.join(", ")}`];
    });
  });
  expect(disagreements).toEqual([]);
  expect(compared).toBeGreaterThan(100);
});

// Each member of DeclaredTypesForTesting answers its operand. `inside` lies in the type that the member declares, `outside` does not.
const checkedMembers: Record<string, { type: string; inside: string[]; outside: string[] }> = {
  string: { type: "string", inside: ['""', '"a".repeat(3) + "b"'], outside: ["1", "undefined", "new String('a')"] },
  number: { type: "number", inside: ["1", "0.5", "NaN", "-0"], outside: ['"1"', "1n", "null"] },
  int32: { type: "int32", inside: ["0", "-2147483648", "2147483647"], outside: ["0.5", "2147483648", "NaN", "-0"] },
  bigint: { type: "bigint", inside: ["1n", "2n ** 70n"], outside: ["1", "Object(1n)"] },
  boolean: { type: "boolean", inside: ["true", "false"], outside: ["0", "undefined"] },
  undefined: { type: "undefined", inside: ["undefined"], outside: ["null", "0"] },
  null: { type: "null", inside: ["null"], outside: ["undefined", "{}"] },
  object: { type: "object", inside: ["{}", "[]", "() => {}", "new Proxy({}, {})"], outside: ["null", '"a"', "Symbol()"] },
  promise: { type: "Promise", inside: ["Promise.resolve(1)", "new (class extends Promise {})(() => {})"], outside: ["{ then() {} }", "undefined"] },
  receiver: { type: "this", inside: ["instance"], outside: ["new DeclaredTypesForTesting()", "undefined"] },
  sameClass: { type: "DeclaredTypesForTesting", inside: ["instance", "new DeclaredTypesForTesting()", "new (class extends DeclaredTypesForTesting {})()"], outside: ["Object.create(DeclaredTypesForTesting.prototype)", "{}"] },
  abortSignal: { type: "AbortSignal", inside: ["new AbortController().signal"], outside: ["new AbortController()", "new EventTarget()"] },
  array: { type: "Array", inside: ["[]", "[1, , 3]"], outside: ["new Uint8Array(1)", "{ length: 0 }", "new Proxy([], {})"] },
  arrayBuffer: { type: "ArrayBuffer", inside: ["new ArrayBuffer(1)"], outside: ["new SharedArrayBuffer(1)", "new Uint8Array(1)"] },
  blob: { type: "Blob", inside: ["new Blob([])", "Bun.file('a')", "new File([], 'a')"], outside: ["new Response('')", "artifact"] },
  buffer: { type: "Buffer", inside: ["Buffer.alloc(1)", "Buffer.alloc(2).subarray(1)"], outside: ["new Uint8Array(1)", "new ArrayBuffer(1)"] },
  date: { type: "Date", inside: ["new Date(0)", "new Date(NaN)"], outside: ["0", "Object.create(Date.prototype)"] },
  error: { type: "Error", inside: ["new Error('a')", "new TypeError('a')"], outside: ["Object.create(Error.prototype)", "{ message: 'a' }"] },
  headers: { type: "Headers", inside: ["new Headers()"], outside: ["{}", "new Map()"] },
  readableStream: { type: "ReadableStream", inside: ["new ReadableStream()"], outside: ["new WritableStream()", "{}"] },
  uint8Array: { type: "Uint8Array", inside: ["new Uint8Array(1)", "Buffer.alloc(1)"], outside: ["new Int8Array(1)", "new Uint8ClampedArray(1)", "[]"] },
  url: { type: "URL", inside: ["new URL('http://a')"], outside: ['"http://a"', "new URLSearchParams()"] },
  numberOrUndefined: { type: "number | undefined", inside: ["1", "undefined"], outside: ["null", '"1"'] },
  stringOrBufferOrNull: { type: "string | Buffer | null", inside: ['"a"', "Buffer.alloc(1)", "null"], outside: ["undefined", "new Uint8Array(1)"] },
};

const prelude = `
  const { DeclaredTypesForTesting } = require("bun:internal-for-testing");
  const instance = new DeclaredTypesForTesting();
`;
// Blob::from_js takes it for a Blob, and it is no JSBlob.
const buildArtifact = `const artifact = (await Bun.build({ entrypoints: [process.argv[1]] })).outputs[0];`;

async function run(body: string) {
  using dir = tempDir("checked-returns", { "entry.js": "export default 1;" });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--expose-internals", "-e", prelude + (body.includes("artifact") ? buildArtifact : "") + body, join(String(dir), "entry.js")],
    env: { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const messageOf = (member: string, type: string) => `DeclaredTypesForTesting.${member} is declared as ${type}, but its value has another type`;

test("a value inside the declared type passes the check", async () => {
  const calls = Object.entries(checkedMembers).flatMap(([member, { inside }]) =>
    inside.map(value => `{ const value = ${value}; if (!Object.is(instance.${member}(value), value)) throw new Error(${JSON.stringify(`${member}(${value})`)}); }`),
  );
  const { stdout, stderr, exitCode } = await run(`
    ${calls.join("\n")}
    if (DeclaredTypesForTesting.number(1) !== 1) throw new Error("static");
    instance.hold("a");
    console.log(instance.heldString, instance.firstHeldString, instance.firstHeldString);
  `);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "a a a\n", stderr: "", exitCode: 0 });
});

test.concurrent.each(Object.entries(checkedMembers).flatMap(([member, { type, outside }]) => outside.map(value => [member, value, type] as const)))(
  "%s(%s) ends the process and names the member",
  async (member, value, type) => {
    const { stdout, stderr, exitCode } = await run(`instance.${member}(${value}); console.log("returned");`);
    expect(stderr).toContain(messageOf(member, type));
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  },
);

test.concurrent.each([
  ["a static function", `DeclaredTypesForTesting.number("1");`, messageOf("number", "number")],
  ["a getter", `instance.hold(1); instance.heldString;`, messageOf("heldString", "string")],
  ["a getter that keeps its first answer", `instance.hold(1); instance.firstHeldString;`, messageOf("firstHeldString", "string")],
])("%s is checked too", async (_, body, message) => {
  const { stdout, stderr, exitCode } = await run(`${body} console.log("returned");`);
  expect(stderr).toContain(message);
  expect(stdout).toBe("");
  expect(exitCode).not.toBe(0);
});

// What the class generator makes of a class with one member.
async function generate(member: string) {
  const codegen = join(import.meta.dir, "../../../src/codegen");
  using dir = tempDir("declared-types", {
    "a.classes.ts": `import { define } from ${JSON.stringify(join(codegen, "class-definitions.ts"))};
      export default [define({ name: "Blob", rustPath: "crate::Blob", proto: { member: ${member} } })];`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(codegen, "generate-classes.ts"), join(String(dir), "a.classes.ts"), String(dir), String(dir)],
    env: bunEnv,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const read = (name: string) => (exitCode === 0 ? readFileSync(join(String(dir), name), "utf8") : "");
  return { stderr, rust: read("generated_classes.rs"), cpp: read("ZigGeneratedClasses.cpp") };
}

test.concurrent.each([
  ["number", "return_kind::Number"],
  ["number | null", "return_kind::Nullable<return_kind::Number>"],
  ["number | undefined", "return_kind::Optional<return_kind::Number>"],
])("the return type of the Rust method has to prove %s", async (type, kind) => {
  expect((await generate(`{ fn: "member", returns: "${type}" }`)).rust).toContain(`proven_return::proven_return::<${kind}, _>(Blob::member(t, g, c))`);
});

test.concurrent("a type that is checked asks nothing of the Rust method, and is checked in every build", async () => {
  const { rust, cpp } = await generate(`{ fn: "member", returns: "number | string", checkedAtRuntime: true }`);
  expect(rust).not.toContain("proven_return::proven_return::<");
  expect(cpp).toContain(`panicOnValueOutsideDeclaredType(vm, "Blob", "member", "number | string");`);
  expect(cpp).not.toContain("if constexpr (ASSERT_ENABLED || ASAN_ENABLED) {");
});

test.concurrent.each([
  [`{ fn: "member", returns: "number | string" }`, "is not a type that can be proven"],
  [`{ fn: "member", returns: "number | null | undefined" }`, "is not a type that can be proven"],
  [`{ fn: "member", returns: "this" }`, "is not a type that can be proven"],
  [`{ fn: "member", checkedAtRuntime: true }`, "'checkedAtRuntime' goes with the type that is checked"],
  [`{ fn: "member", returns: "Nobody", checkedAtRuntime: true }`, "no test is known for instances of Nobody"],
])("%s is refused", async (member, message) => {
  expect((await generate(member)).stderr).toContain(message);
});
