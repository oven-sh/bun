import path from "node:path";
import { indentation, lineWidth, rustMarker } from "./lines.ts";
import type { Entry, Parameter } from "./model.ts";
import { entriesOf, wireFlagsOf, wireParametersOf } from "./model.ts";
import { rustIdentifier, snakeCase } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { externalPathsOfEntries, holdsVector, idsImport, rustTypeOf, toWords } from "./rust-types.ts";

function paramType(parameter: Parameter): string {
  if (parameter.tag === "Operand") {
    if (parameter.isVariadic) return "&[ValueId]";
    return parameter.isOptional ? "Option<ValueId>" : "ValueId";
  }
  const kind = parameter.kind;
  if (kind.tag === "List") return `&[${rustTypeOf(kind.element)}]`;
  const type = rustTypeOf(kind, parameter.isOptional);
  return (kind.tag === "Record" || kind.tag === "Variant") && holdsVector(kind) ? `&${type}` : type;
}

function isSimple(parameter: Parameter): boolean {
  if (parameter.tag === "Operand") return !parameter.isVariadic;
  return parameter.kind.tag !== "List" && parameter.kind.tag !== "Record" && parameter.kind.tag !== "Variant";
}

function simpleWords(parameter: Parameter): string[] {
  const name = rustIdentifier(parameter.name);
  if (parameter.tag === "Operand") return [parameter.isOptional ? `optional_id_to_word(${name})` : `${name}.to_word()`];
  return toWords(parameter.kind, name, parameter.isOptional, false);
}

function push(parameter: Parameter): string[] {
  const name = rustIdentifier(parameter.name);
  if (isSimple(parameter)) return simpleWords(parameter).map(word => `words.push(${word});`);
  const pushCount = `words.push(${name}.len() as u32);`;
  if (parameter.tag === "Operand") return [pushCount, `words.extend(${name}.iter().map(|operand| operand.to_word()));`];
  const kind = parameter.kind;
  if (kind.tag !== "List") return [`${name}.append_to(&mut words);`];
  if (kind.element.tag === "Record" || kind.element.tag === "Variant") {
    return [pushCount, `for element in ${name} { element.append_to(&mut words); }`];
  }
  const elementWords = toWords(kind.element, "element", false, false);
  if (elementWords.length === 1 && elementWords[0] === "element")
    return [pushCount, `words.extend_from_slice(${name});`];
  return [pushCount, `for &element in ${name} { ${elementWords.map(word => `words.push(${word});`).join(" ")} }`];
}

interface Edges {
  readonly setup: readonly string[];
  readonly argument: string;
}

function edgesOf(entry: Entry): Edges {
  const names = entry.targets.map(target => rustIdentifier(target.name));
  if (!entry.targets.some(target => target.isVariadic)) return { setup: [], argument: `&[${names.join(", ")}]` };
  const pushes = entry.targets.map((target, index) =>
    target.isVariadic ? `edges.extend_from_slice(${names[index]});` : `edges.push(${names[index]});`,
  );
  return { setup: ["let mut edges: SmallVec<[Edge<'_>; 8]> = SmallVec::new();", ...pushes], argument: "&edges" };
}

function builderFunction(entry: Entry): string[] {
  const flags = wireFlagsOf(entry);
  const parameters = wireParametersOf(entry);
  const edges = edgesOf(entry);
  const signature = [
    "&mut self",
    ...parameters.map(parameter => `${rustIdentifier(parameter.name)}: ${paramType(parameter)}`),
    ...flags.map(flag => `${rustIdentifier(flag.name)}: bool`),
    ...entry.targets.map(target => `${rustIdentifier(target.name)}: ${target.isVariadic ? "&[Edge<'_>]" : "Edge<'_>"}`),
  ];
  const flagsWord = flags
    .map(flag =>
      flag.bit === 0
        ? `u32::from(${rustIdentifier(flag.name)})`
        : `u32::from(${rustIdentifier(flag.name)}) << ${flag.bit}`,
    )
    .join(" | ");
  const call = (words: string) =>
    entry.isTerminator
      ? `self.terminate(TerminatorKind::${entry.name}, ${words}, ${edges.argument});`
      : `self.emit(Opcode::${entry.name}, ${words})`;
  const head = `${indentation}pub fn ${rustIdentifier(entry.name)}(${signature.join(", ")})${entry.isTerminator ? "" : " -> ValueId"} {`;
  let body: string[];
  if (parameters.every(isSimple)) {
    const words = [...(flags.length > 0 ? [flagsWord] : []), ...parameters.flatMap(simpleWords)];
    body = [...edges.setup, call(`&[${words.join(", ")}]`)];
  } else {
    body = [
      "let mut words: SmallVec<[u32; 16]> = SmallVec::new();",
      ...(flags.length > 0 ? [`words.push(${flagsWord});`] : []),
      ...parameters.flatMap(push),
      ...edges.setup,
      call("&words"),
    ];
  }
  const oneLine = `${head} ${body.join(" ")} }`;
  if (oneLine.length <= lineWidth) return [oneLine];
  return [head, ...body.map(statement => `${indentation}${indentation}${statement}`), `${indentation}}`];
}

function builderRs(entries: readonly Entry[]): string[] {
  return [
    rustMarker,
    "",
    "use smallvec::SmallVec;",
    "",
    "use super::entries::{Opcode, TerminatorKind};",
    "use super::enums::*;",
    "use super::program_enums::*;",
    "use super::records::*;",
    ...externalPathsOfEntries(entries).map(externalPath => `use ${externalPath};`),
    "use crate::ir::builder::{Edge, FunctionBuilder};",
    idsImport,
    "",
    "impl FunctionBuilder {",
    ...entries.flatMap(builderFunction),
    "}",
  ];
}

export function emitRustBuilder(context: EmitContext): OutputFile[] {
  const wireEntries = entriesOf(context.schema).filter(entry => entry.isWire);
  return [...Map.groupBy(wireEntries, entry => entry.file.path)].map(([schemaFile, entries]) => ({
    name: `builder_${snakeCase(path.basename(schemaFile, ".def").replaceAll("-", "_"))}.rs`,
    lines: builderRs(entries),
  }));
}
