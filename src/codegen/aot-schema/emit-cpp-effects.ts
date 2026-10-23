import { findIndexFieldOfElements } from "./check-entries.ts";
import { blocks, cppHeader, groupedCases, indentation, inNamespace } from "./lines.ts";
import type { Effects, HeapReference, Schema } from "./model.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

interface EffectsDeclaration {
  readonly name: string;
  readonly effects: Effects;
}

const effectFlags = ["throws", "collects", "suspends", "terminates"] as const;

function locationStatements(verb: "reads" | "writes", reference: HeapReference, subject: string | null): string[] {
  const heap = `AbstractHeap::${reference.heap.name}`;
  const wholeHeap = `sink.${verb}(MemoryLocation(${heap}));`;
  if (reference.indexes.length === 0) return [wholeHeap];
  const payloadIndexes = reference.indexes.flatMap(index => (index.tag === "Payload" ? [index.field] : []));
  if (payloadIndexes.length > 0 && subject === null) return [`sink.${verb}AtPayload(${heap});`];
  const indexOfElements =
    payloadIndexes.length === 1 ? findIndexFieldOfElements(payloadIndexes[0].kind, reference.heap.indexKinds[0]) : null;
  if (indexOfElements !== null) {
    const location = `MemoryLocation::at(${heap}, locationIndexOf(element.${indexOfElements.name}))`;
    return [
      `for (const auto& element : ${subject}.${payloadIndexes[0].name}())`,
      `${indentation}sink.${verb}(${location});`,
    ];
  }
  const indexes = reference.indexes.map(index => {
    const value =
      index.tag === "Member" ? `${index.type.name}::${index.member.name}` : `${subject}.${index.field.name}()`;
    return `locationIndexOf(${value})`;
  });
  const exactLocation = `sink.${verb}(MemoryLocation::at(${heap}, ${indexes.join(", ")}));`;
  const optionalIndexes = payloadIndexes.filter(field => field.isOptional);
  if (optionalIndexes.length === 0) return [exactLocation];
  const presenceTest = optionalIndexes.map(field => `${subject}.${field.name}()`).join(" && ");
  return [`if (${presenceTest})`, indentation + exactLocation, "else", indentation + wholeHeap];
}

function effectStatements(effects: Effects, subject: string | null): string[] {
  if (effects.isAsOverload) return ["sink.asOverload();"];
  return [
    ...(effects.isUnknownCode ? ["sink.unknownCode();"] : []),
    ...(effects.readsAllHeaps ? ["sink.readsAllHeaps();"] : []),
    ...effects.reads.flatMap(reference => locationStatements("reads", reference, subject)),
    ...effects.writes.flatMap(reference => locationStatements("writes", reference, subject)),
    ...effectFlags.filter(flag => effects[flag]).map(flag => `sink.${flag}();`),
  ];
}

function effectFunction(
  parameter: string,
  selector: string,
  enumName: string,
  declarations: readonly EffectsDeclaration[],
  subject: string | null,
): string[] {
  return [
    "template<typename Sink>",
    `constexpr void forEachDeclaredEffect(${parameter}, Sink& sink)`,
    "{",
    `${indentation}switch (${selector}) {`,
    ...groupedCases(
      enumName,
      declarations.map(({ name, effects }) => ({
        label: name,
        body: [...effectStatements(effects, subject), "return;"],
      })),
    ),
    `${indentation}}`,
    `${indentation}RELEASE_ASSERT_NOT_REACHED_UNDER_CONSTEXPR_CONTEXT();`,
    "}",
  ];
}

function effectsHeaders(schema: Schema): OutputFile[] {
  const header = (name: string, includes: readonly string[], ...functions: readonly string[][]): OutputFile => ({
    name,
    lines: cppHeader(includes, inNamespace("Typed", blocks(...functions))),
  });
  const enumIncludes = ['"AOTMemoryLocation.h"', '"AOTSchemaEnums.h"'];
  const parts = [
    header(
      "AOTSchemaValueEffects.h",
      ['"AOTBlock.h"', '"AOTMemoryLocation.h"'],
      effectFunction("const Value& value", "value.opcode", "Opcode", schema.operations, "value"),
      effectFunction(
        "const Terminator& terminator",
        "terminator.kind",
        "TerminatorKind",
        schema.terminators,
        "terminator",
      ),
    ),
    header(
      "AOTSchemaEntryEffects.h",
      enumIncludes,
      effectFunction("Opcode opcode", "opcode", "Opcode", schema.operations, null),
      effectFunction("TerminatorKind kind", "kind", "TerminatorKind", schema.terminators, null),
    ),
    header(
      "AOTSchemaInlineBuiltinEffects.h",
      enumIncludes,
      effectFunction("InlineBuiltin builtin", "builtin", "InlineBuiltin", schema.inlineBuiltins, null),
      effectFunction("NamedEffectSet set", "set", "NamedEffectSet", schema.namedEffects, null),
    ),
    header(
      "AOTSchemaRuntimeOperationEffects.h",
      enumIncludes,
      effectFunction("RuntimeOperation operation", "operation", "RuntimeOperation", schema.runtimeOperations, null),
    ),
  ];
  const partIncludes = parts.map(part => `"${part.name}"`);
  return [...parts, { name: "AOTSchemaEffects.h", lines: cppHeader(partIncludes, []) }];
}

export function emitCppEffects(context: EmitContext): OutputFile[] {
  return effectsHeaders(context.schema);
}
