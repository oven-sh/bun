import { cppMarker, indentation, pack } from "./lines.ts";
import type { Entry, Schema } from "./model.ts";
import { isLegalIn } from "./model.ts";
import { cppEmitterClassName, cppGenerateFunctionName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

function dispatchCase(enumName: string, name: string, family: string, argument: string): string {
  const call = `emitter<${cppEmitterClassName(family)}>().${cppGenerateFunctionName(name)}(${argument});`;
  return `${indentation}case ${enumName}::${name}: ${call} break;`;
}

function unreachableCases(enumName: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const labels = names.map(name => `case ${enumName}::${name}:`);
  return [...pack(labels, indentation), `${indentation}${indentation}RELEASE_ASSERT_NOT_REACHED();`];
}

function dispatchInc(entries: readonly Entry[], enumName: string, argument: string): string[] {
  const generated = entries.filter(entry => isLegalIn(entry, "Placed"));
  const unreachable = entries.filter(entry => !isLegalIn(entry, "Placed"));
  return [
    cppMarker,
    "",
    ...generated.map(entry => dispatchCase(enumName, entry.name, entry.family, argument)),
    ...unreachableCases(
      enumName,
      unreachable.map(entry => entry.name),
    ),
  ];
}

function inlineDispatchInc(schema: Schema): string[] {
  const generated = schema.inlineBuiltins.filter(builtin => !builtin.isFormOnly);
  const unreachable = schema.inlineBuiltins.filter(builtin => builtin.isFormOnly);
  return [
    cppMarker,
    "",
    ...generated.map(builtin => dispatchCase("InlineBuiltin", builtin.name, builtin.family, "call")),
    ...unreachableCases(
      "InlineBuiltin",
      unreachable.map(builtin => builtin.name),
    ),
  ];
}

export function emitCppDispatch(context: EmitContext): OutputFile[] {
  const { schema } = context;
  return [
    { name: "AOTSchemaOperationDispatch.inc", lines: dispatchInc(schema.operations, "Opcode", "value") },
    { name: "AOTSchemaTerminatorDispatch.inc", lines: dispatchInc(schema.terminators, "TerminatorKind", "terminator") },
    { name: "AOTSchemaInlineBuiltinDispatch.inc", lines: inlineDispatchInc(schema) },
  ];
}
