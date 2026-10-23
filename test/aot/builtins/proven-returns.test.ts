import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { ClassType, FunctionDefinition, Getter, type ClassMember } from "../../../src/codegen/bindgen-lib-internal";
import { loadSchemaFile } from "../../../src/codegen/bindgen-load";
import type {
  DumpedClass,
  DumpedEntry,
  DumpedParameter,
  DumpedType,
  Primitive,
} from "../../../src/codegen/builtins/dump";
import type { TypeSpec } from "../../../src/codegen/builtins/vocabulary";
import { parseDeclaredType } from "../../../src/codegen/declared-type-checks";
import { run } from "../harness/run";
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
const classesByPrototype = new Map(
  table.classes.flatMap(builtinClass =>
    builtinClass.prototype === null ? [] : [[builtinClass.prototype, builtinClass] as const],
  ),
);

// No program can name a class whose path is written between percent signs, so bun-types says nothing about it.
const hasPublicPath = (entry: DumpedEntry) => !entry.path.includes("%");

// "node:module.SourceMap" is an export of a module, any other path starts at a global.
const typeOfValueAt = (path: string) => `typeof ${path.replace(/^(\w+:[^.]+)\./, 'import("$1").')}`;

function instanceTypeOf(builtinClass: DumpedClass | undefined): string | undefined {
  const classConstructor = builtinClass?.constructor ? entriesByToken.get(builtinClass.constructor) : undefined;
  return classConstructor === undefined || !hasPublicPath(classConstructor)
    ? undefined
    : `InstanceType<${typeOfValueAt(classConstructor.path)}>`;
}

function holderTypeOf(entry: DumpedEntry): string | undefined {
  const holder = entry.holder === null ? undefined : entriesByToken.get(entry.holder);
  if (holder === undefined) return undefined;
  if (holder.kind === "Prototype") return instanceTypeOf(classesByPrototype.get(holder.token));
  return hasPublicPath(holder) ? `(${typeOfValueAt(holder.path)})` : undefined;
}

// An operand that is handed back is whatever the call takes for it.
function typeScriptOfPart(
  part: DumpedType["parts"][number],
  receiverType: string | undefined,
  parameters: readonly DumpedParameter[],
): string | undefined {
  if (part.part === "Instance") return instanceTypeOf(classesByToken.get(part.class)) ?? "object";
  if (part.part !== "Operand") return undefined;
  if (part.operand === "this") return receiverType;
  const parameter = parameters.find(({ operand }) => Bun.deepEquals(operand, part.operand));
  return parameter === undefined
    ? undefined
    : parameter.accepted.isAnything
      ? "unknown"
      : typeScriptOf(parameter.accepted, receiverType, []);
}

function typeScriptOf(
  type: DumpedType,
  receiverType: string | undefined,
  parameters: readonly DumpedParameter[],
): string | undefined {
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
  .flatMap(entry =>
    entry.overloads.map(overload => ({
      ...overload,
      name: entry.name,
      isSymbolName: entry.isSymbolName,
      holderType: holderTypeOf(entry),
    })),
  )
  .filter(
    o =>
      o.isProvenByConstruction &&
      !o.result.type.isAnything &&
      o.receiver !== null &&
      (o.mode === "Get" || o.mode === "Call"),
  )
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
  for (const path of ["Request.prototype.url", "Buffer.prototype.readInt8", "Bun.CryptoHasher.algorithms"])
    expect(overloads.map(o => o.path)).toContain(path);
  expect((await errorsOf(lines)).map(line => overloads[line - 2].path)).toEqual([]);
});

test("a definition that disagrees is reported", async () => {
  expect(await errorsOf(['export const Request_url: Agree<Request["url"], number> = true;'])).toEqual([2]);
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
  const { stdout, stderr } = await run([bunExe(), "check"], String(dir));
  return [...(stdout + stderr).matchAll(/(agree\.ts)[":( ]+(?:line=")?(\d+)/g)].map(match => Number(match[2]));
}

const primitivesOfAlternative: Record<string, Primitive> = {
  string: "String",
  number: "Number",
  int32: "Number",
  bigint: "BigInt",
  boolean: "Boolean",
  undefined: "Undefined",
  null: "Null",
};

// An instance of a class is one of every class that its class extends: an S3File is a Blob.
function isInstanceOfOneOf(token: string, classes: Set<string>): boolean {
  for (
    let builtinClass = classesByToken.get(token);
    builtinClass;
    builtinClass = builtinClass.parent === null ? undefined : classesByToken.get(builtinClass.parent)
  ) {
    if (classes.has(builtinClass.token)) return true;
  }
  return classes.has(token);
}

// What a type of the table admits and a declared type does not. The receiver is an instance of `receiverClass`.
function partsOutside(type: DumpedType, declared: string, receiverClass: string | undefined): string[] {
  const alternatives = parseDeclaredType(declared);
  const primitives = new Set(
    alternatives.flatMap(alternative =>
      typeof alternative === "string" ? (primitivesOfAlternative[alternative] ?? []) : [],
    ),
  );
  const instances = new Set(
    alternatives.flatMap(alternative =>
      typeof alternative === "object" ? alternative.instance : alternative === "Promise" ? alternative : [],
    ),
  );
  const admitsEveryObject = alternatives.includes("object");
  const outside: string[] = type.primitives.filter(primitive => !primitives.has(primitive));
  if (type.isAnything) outside.push("anything");
  if (type.integers !== null && !primitives.has("Number")) outside.push("integers");
  if (type.stringLiterals.length > 0 && !primitives.has("String")) outside.push("strings");
  if ((type.hasAnyObject || type.hasAnyFunction || type.hasPlainData) && !admitsEveryObject) outside.push("any object");
  for (const part of type.parts) {
    if (part.part === "Operand" && part.operand === "this") {
      if (
        alternatives.includes("this") ||
        admitsEveryObject ||
        (receiverClass !== undefined && isInstanceOfOneOf(receiverClass, instances))
      )
        continue;
    }
    if (part.part === "Instance" && (admitsEveryObject || isInstanceOfOneOf(part.class, instances))) continue;
    outside.push(part.part === "Instance" ? part.class : part.part);
  }
  return outside;
}

const wordsOfPrimitives: Partial<Record<Primitive, string>> = {
  Undefined: "undefined",
  Null: "null",
  Boolean: "boolean",
  Number: "number",
  String: "string",
  BigInt: "bigint",
};

// A type of a schema in the words of parseDeclaredType, if they can say it.
function wordsOf(spec: TypeSpec): string[] | undefined {
  switch (spec.type) {
    case "Primitive":
      return wordsOfPrimitives[spec.primitive] === undefined ? undefined : [wordsOfPrimitives[spec.primitive]!];
    case "Integers":
      return ["number"];
    case "StringLiterals":
      return ["string"];
    case "Object":
    case "PlainData":
    case "Layout":
      return ["object"];
    case "Instance":
      return [spec.class];
    case "Operand":
      return spec.operand === "this" ? ["this"] : undefined;
    case "Union": {
      const members = spec.members.map(wordsOf);
      return members.includes(undefined) ? undefined : members.flat();
    }
    default:
      return undefined;
  }
}

function declaredResultOf(member: ClassMember | undefined): string | undefined {
  const types =
    member instanceof Getter
      ? [member.type]
      : member instanceof FunctionDefinition
        ? member.signatures.map(signature => signature.returns)
        : [];
  const words = types.map(type => wordsOf(type.resultType));
  return words.length === 0 || words.includes(undefined) ? undefined : [...new Set(words.flat())].join(" | ");
}

async function loadClassesOfSchemas(): Promise<Map<string, ClassType>> {
  const root = join(import.meta.dir, "../../..");
  const classes = new Map<string, ClassType>();
  for (const file of [...new Bun.Glob("src/**/*.bind.ts").scanSync({ cwd: root, absolute: true })].sort()) {
    for (const type of (await loadSchemaFile(`bun_runtime=${file}`)).types)
      if (type instanceof ClassType) classes.set(type.name, type);
  }
  return classes;
}

// The schema is the one source of what a member returns. A row that is written by hand for some operands may say more, never something else.
test("a result that is written by hand lies inside the type that the schema declares", async () => {
  const definitions = await loadClassesOfSchemas();
  const classesByConstructor = new Map(
    table.classes.flatMap(builtinClass =>
      builtinClass.constructor === null ? [] : [[builtinClass.constructor, builtinClass] as const],
    ),
  );
  let compared = 0;
  const disagreements = table.entries.flatMap(entry => {
    if (entry.holder === null) return [];
    const ofPrototype = classesByPrototype.get(entry.holder);
    const definition = definitions.get((ofPrototype ?? classesByConstructor.get(entry.holder))?.token ?? "");
    const declared = declaredResultOf(
      (ofPrototype ? definition?.protoMembers : definition?.staticMembers)?.find(member => member.name === entry.name),
    );
    if (!declared) return [];
    return entry.overloads.flatMap(overload => {
      if (
        overload.isProvenByConstruction ||
        overload.isUndeclared ||
        (overload.mode !== "Call" && overload.mode !== "Get")
      )
        return [];
      compared++;
      const outside = partsOutside(overload.result.type, declared, ofPrototype?.token);
      return outside.length === 0 ? [] : [`${entry.path}: ${declared} admits no ${outside.join(", ")}`];
    });
  });
  expect(disagreements).toEqual([]);
  expect(compared).toBeGreaterThan(100);
});
