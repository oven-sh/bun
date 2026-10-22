import type { FeatureModel } from "../../../scripts/build/trim/types.ts";
import type { Schema } from "../aot-schema/load.ts";
import { buildAttachments, createTextForms } from "./build-attachments.ts";
import { buildClasses, buildEntries, buildFunctions, buildLayouts, ModelBuilder } from "./build-entries.ts";
import { buildOverloads } from "./build-overloads.ts";
import { buildSyntax, type SyntaxUses } from "./build-syntax.ts";
import { TypeInterner } from "./build-types.ts";
import { checkModel } from "./check.ts";
import type { SourcedDeclaration } from "./declarations.ts";
import { buildDispatches } from "./dispatch.ts";
import type { ModelEngineFile, TableModel } from "./model.ts";
import { numberModel } from "./number.ts";
import { applyTextHashes } from "./verification.ts";

export interface ModelInput {
  declarations: readonly SourcedDeclaration[];
  schema: Schema;
  features: FeatureModel;
  engineFiles: readonly ModelEngineFile[];
  syntaxUses: SyntaxUses;
}

// An operand that may hold an object and has no `uses` counts as used in every way.
function reportOperandsWithoutUses({ operandsWithoutUses }: ModelBuilder): void {
  const groups = new Map<string, { operands: number; entries: Set<unknown> }>();
  for (const { builtin, source } of operandsWithoutUses) {
    const key = `${source.origin} ${source.proof}`;
    const group = groups.get(key) ?? { operands: 0, entries: new Set() };
    group.operands++;
    group.entries.add(builtin);
    groups.set(key, group);
  }
  const summary = [...groups].map(([key, { operands, entries }]) => `${key}: ${operands} in ${entries.size} entries`);
  console.error(`builtins table: operands without uses: ${summary.join(", ") || "none"}`);
  if (process.env.AOT_LIST_OPERANDS_WITHOUT_USES === undefined) return;
  for (const { builtin, operand, source } of operandsWithoutUses) {
    console.error(`  ${source.origin} ${source.proof} ${source.file}: ${builtin.text} ${operand}`);
  }
}

export function buildModel(input: ModelInput): TableModel {
  const { declarations, schema, features, syntaxUses } = input;
  const builder = new ModelBuilder(input);
  const types = new TypeInterner(builder);
  const { problems } = builder;

  const buildStages: readonly (() => void)[] = [
    () => buildEntries(builder, declarations),
    () => buildClasses(builder, declarations, types),
    () => buildLayouts(builder, declarations, types),
    () => buildFunctions(builder, declarations),
    () => createTextForms(builder),
    () => buildOverloads(builder, types),
    () => buildDispatches(builder, types),
    () => buildAttachments(builder, features, types),
    () => buildSyntax(builder, declarations, syntaxUses),
  ];
  for (const runStage of buildStages) {
    runStage();
    problems.throwIfAny();
  }

  const model = numberModel(builder, types);
  problems.throwIfAny();
  reportOperandsWithoutUses(builder);

  applyTextHashes(model);
  checkModel(model, schema, problems);
  problems.throwIfAny();
  return model;
}
