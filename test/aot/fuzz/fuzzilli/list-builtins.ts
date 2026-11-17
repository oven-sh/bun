// bun list-builtins.ts <build>/codegen/aot_builtin_table.json <output.json>
// Writes what BunCompilerProfile.swift needs to know about Bun's and Node's APIs: names, parameters, option bags, handlers and results.
import { readFileSync, writeFileSync } from "node:fs";
import { excluded } from "./excluded-builtins";

type Type = {
  isAnything: boolean;
  hasAnyObject: boolean;
  hasAnyFunction: boolean;
  hasPlainData: boolean;
  primitives: string[];
  integers: unknown;
  stringLiterals: string[];
  parts: { part: string; class?: string }[];
};
type Parameter = { mode: string; accepted: Type; uses: string[]; namedMembers: string[]; calledMembers: string[] };
type Overload = {
  mode: string;
  parameters: Parameter[];
  result: { type: Type };
  handlerCalls: { callee: { operand?: { argument?: number }; path?: (string | null)[] } }[];
};
type Entry = {
  token: string;
  path: string;
  kind: string;
  origin: string;
  holder: string;
  name: string;
  isSymbolName: boolean;
  platforms: string[];
  overloads: Overload[];
};
type Class = { token: string; origin: string; constructor: string | null; prototype: string | null };

const [tablePath, outputPath] = process.argv.slice(2);
const table: { entries: Entry[]; classes: Class[] } = JSON.parse(readFileSync(tablePath, "utf8"));

const classOfPrototype = new Map(table.classes.filter(c => c.prototype).map(c => [c.prototype!, c.token]));
const hostClasses = new Set(table.classes.filter(c => c.origin === "Host").map(c => c.token));
const engineTypes: Record<string, string> = {
  Array: "array",
  Promise: "promise",
  Uint8Array: "uint8array",
  ArrayBuffer: "arraybuffer",
  Map: "map",
  Set: "set",
  Date: "date",
  RegExp: "regexp",
};

function encodeType(type: Type): string[] {
  if (type.isAnything) return ["anything"];
  const encoded = new Set<string>();
  for (const primitive of type.primitives) {
    if (primitive === "Number") encoded.add(type.integers ? "integer" : "number");
    else if (primitive === "String") encoded.add("string");
    else if (["Boolean", "BigInt", "Undefined"].includes(primitive)) encoded.add(primitive.toLowerCase());
  }
  if (type.stringLiterals.length) encoded.add("enum:" + type.stringLiterals.join("|"));
  if (type.hasAnyFunction) encoded.add("function");
  if (type.hasAnyObject || type.hasPlainData) encoded.add("object");
  for (const part of type.parts) {
    if (part.part !== "Instance" || !part.class) encoded.add("object");
    else if (hostClasses.has(part.class)) encoded.add("group:" + part.class);
    else encoded.add(engineTypes[part.class] ?? "object");
  }
  return encoded.size ? [...encoded] : ["anything"];
}

function encodeSignature(overload: Overload) {
  return {
    parameters: overload.parameters.map((parameter, index) => ({
      type: encodeType(parameter.accepted),
      isOptional: parameter.mode !== "Required",
      isCallback: parameter.accepted.hasAnyFunction && parameter.uses.some(use => use.startsWith("Calls")),
      members: parameter.namedMembers,
      handlers: [
        ...parameter.calledMembers.map(member => [member]),
        ...overload.handlerCalls
          .filter(call => call.callee.operand?.argument === index && call.callee.path)
          // A step without a name stands for any key, like a path in `routes`.
          .map(call => call.callee.path!.map(step => step ?? "/a")),
      ],
    })),
    result: encodeType(overload.result.type),
  };
}

function rootOf(path: string) {
  const module = /^((?:node|bun):[\w/]+|undici)(?:\.(.*))?$/.exec(path);
  if (module) return { root: `require("${module[1]}")`, rest: module[2]?.split(".") ?? [] };
  const [root, ...rest] = path.split(".");
  return { root, rest };
}

const groups = new Map<
  string,
  { name: string; properties: Record<string, string[]>; methods: Record<string, ReturnType<typeof encodeSignature>> }
>();
const groupOf = (name: string) => groups.getOrInsertComputed(name, () => ({ name, properties: {}, methods: {} }));
const calls: object[] = [];
const roots: Record<string, object> = {};
const isName = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

for (const entry of table.entries) {
  if (entry.origin !== "Host" || entry.isSymbolName || !isName(entry.name) || !entry.platforms.includes("Linux"))
    continue;
  const call =
    entry.overloads.find(overload => overload.mode === "Construct") ??
    entry.overloads.find(overload => overload.mode === "Call");
  const instanceClass = classOfPrototype.get(entry.holder);
  if (instanceClass) {
    if (call && entry.kind === "Method") groupOf(instanceClass).methods[entry.name] = encodeSignature(call);
    else if (entry.kind === "Accessor" || entry.kind === "DataProperty")
      groupOf(instanceClass).properties[entry.name] = ["anything"];
    continue;
  }
  if (entry.path.startsWith("%") || entry.path.includes(".prototype") || excluded.test(entry.path)) continue;
  const { root, rest } = rootOf(entry.path);
  if (!rest.every(isName)) continue;
  if (rest.length === 0) {
    if (entry.kind === "Namespace") roots[root] = { group: entry.token };
    else if (call) roots[root] = { constructs: call.mode === "Construct", ...encodeSignature(call) };
  } else if (entry.kind === "Namespace") groupOf(entry.holder).properties[entry.name] = ["group:" + entry.token];
  else if (call && call.mode === "Call") groupOf(entry.holder).methods[entry.name] = encodeSignature(call);
  else if (root.startsWith("require(") && entry.kind === "DataProperty" && /^[a-z]/.test(entry.name)) {
    // The table doesn't describe what a module written in JavaScript exports. By convention it's a function.
    const parameter = { type: ["anything"], isOptional: true, isCallback: false, members: [], handlers: [] };
    const signature = { parameters: [parameter, parameter, parameter], result: ["anything"] };
    groupOf(entry.holder).methods[entry.name] = signature;
    calls.push({ root, path: rest, constructs: false, ...signature });
  } else groupOf(entry.holder).properties[entry.name] = ["anything"];
  if (call) calls.push({ root, path: rest, constructs: call.mode === "Construct", ...encodeSignature(call) });
}
for (const [root, type] of Object.entries(roots)) if ("group" in type) groupOf(type.group as string);

writeFileSync(outputPath, JSON.stringify({ roots, groups: [...groups.values()], calls }));
console.log(`${Object.keys(roots).length} roots, ${groups.size} groups, ${calls.length} calls`);
