import {
  blocks,
  constexprSwitch,
  cppHeader,
  cppSource,
  groupedCases,
  inNamespace,
  indentation,
  macroLines,
  type CaseBody,
} from "./lines.ts";
import type { InlineBuiltin, Kind, Schema } from "./model.ts";
import { cppFamilyMacroName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

function inlineHeader(schema: Schema): string[] {
  const builtins = schema.inlineBuiltins;
  const namesOf = (members: readonly InlineBuiltin[]) => members.map(builtin => builtin.name);
  const macros = [
    macroLines("FOR_EACH_AOT_INLINE_BUILTIN", namesOf(builtins)),
    ...schema.inlineFamilies.map(family =>
      macroLines(
        cppFamilyMacroName("INLINE_BUILTIN", family),
        namesOf(builtins.filter(builtin => builtin.family === family)),
      ),
    ),
  ];
  const lookup = (declarator: string, valueOf: (builtin: InlineBuiltin) => string, defaultValue: string | null) =>
    constexprSwitch({
      signature: `${declarator}(InlineBuiltin builtin)`,
      subject: "builtin",
      enumName: "InlineBuiltin",
      cases: builtins.map(builtin => ({ label: builtin.name, value: valueOf(builtin) })),
      defaultValue,
    });
  const declarations = blocks(
    lookup("InlineBuiltinFamily familyOf", builtin => `InlineBuiltinFamily::${builtin.family}`, null),
    lookup("uint32_t numberOfParametersOf", builtin => String(builtin.parameterKinds.length), "0"),
    lookup("bool hasOptionalSlowPath", builtin => String(builtin.hasOptionalSlowPath), "false"),
    lookup("bool isFormOnly", builtin => String(builtin.isFormOnly), "false"),
    ["JS_EXPORT_PRIVATE bool isValidParameter(InlineBuiltin, uint32_t parameterIndex, uint32_t word);"],
  );
  return cppHeader(['"AOTSchemaEnums.h"'], [...blocks(...macros), "", ...inNamespace("Typed", declarations)]);
}

function parameterTest(kind: Kind): string {
  if (kind.tag === "Enum") return `word < numberOfEnumerators<${kind.type.name}>`;
  if (kind.tag === "Flags") return `!(word >> numberOfEnumerators<${kind.type.name}>)`;
  if (kind.tag === "External" && kind.external.form === "enum") {
    const { name, below } = kind.external;
    if (below === null) throw new Error(`external ${name} is an inline parameter and has no bound`);
    return `word < ${below}`;
  }
  if (kind.tag === "Scalar" && kind.scalar === "UInt8") return "word <= UINT8_MAX";
  throw new Error(`an inline parameter cannot be of kind ${kind.tag}`);
}

function inlineSource(schema: Schema): string[] {
  const bodies: CaseBody[] = [];
  for (const builtin of schema.inlineBuiltins) {
    if (builtin.parameterKinds.length === 0) continue;
    const tests = builtin.parameterKinds.map(parameterTest);
    const body =
      new Set(tests).size === 1
        ? [`return parameterIndex < ${tests.length} && ${tests[0]};`]
        : [
            ...tests.flatMap((test, index) => [`if (parameterIndex == ${index})`, `${indentation}return ${test};`]),
            "return false;",
          ];
    bodies.push({ label: builtin.name, body });
  }
  const definition = [
    "bool isValidParameter(InlineBuiltin builtin, uint32_t parameterIndex, uint32_t word)",
    "{",
    `${indentation}switch (builtin) {`,
    ...groupedCases("InlineBuiltin", bodies),
    `${indentation}default:`,
    `${indentation}${indentation}return false;`,
    `${indentation}}`,
    "}",
  ];
  const includes = ['"AOTSchemaInlineBuiltins.h"', '"IterationKind.h"', '"TypedArrayType.h"'];
  return cppSource(includes, inNamespace("Typed", definition));
}

export function emitCppInlineBuiltins(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaInlineBuiltins.h", lines: inlineHeader(context.schema) },
    { name: "AOTSchemaInlineBuiltins.cpp", lines: inlineSource(context.schema) },
  ];
}
