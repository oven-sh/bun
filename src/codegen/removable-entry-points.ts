import { join } from "node:path";
import {
  featureNamed,
  loadFeatures,
  type FeatureModel,
  type FeatureName,
  type StubKind,
} from "../../scripts/build/trim/features.ts";

let loadedFeatures: FeatureModel | undefined;

export function removableFeatures(): FeatureModel {
  loadedFeatures ??= loadFeatures(join(import.meta.dirname, "..", ".."));
  return loadedFeatures;
}

function featureConstantName(model: FeatureModel, feature: FeatureName): string {
  return featureNamed(model, feature).name;
}

function guardTemplateArguments(model: FeatureModel, feature: FeatureName, stub: StubKind, symbol: string): string {
  return `Bun::Feature::${featureConstantName(model, feature)}, JSC::RemovedFeatureStub::${stub}, ${symbol}`;
}

export function recordedPointer(
  model: FeatureModel,
  feature: FeatureName,
  stub: StubKind,
  symbol: string,
  builtin?: number,
): string {
  const templateArguments = guardTemplateArguments(model, feature, stub, symbol);
  return builtin === undefined
    ? `JSC::removableFunction<${templateArguments}>()`
    : `JSC::removableBuiltinFunction<${templateArguments}, ${builtin}>()`;
}

export function tableEntryRecord(
  model: FeatureModel,
  table: string,
  feature: FeatureName,
  stub: StubKind,
  symbol: string,
  builtin?: number,
): string {
  const templateArguments = `${table}, ${guardTemplateArguments(model, feature, stub, symbol)}`;
  return builtin === undefined
    ? `JSC::recordRemovableTableEntry<${templateArguments}>();`
    : `JSC::recordRemovableTableEntry<${templateArguments}, JSC::GuardOrigin::Builtin, ${builtin}>();`;
}

export function guardedCall(
  model: FeatureModel,
  feature: FeatureName,
  stub: StubKind,
  symbol: string,
  args: string[],
): string {
  return `JSC::callRemovable<${guardTemplateArguments(model, feature, stub, symbol)}>(${args.join(", ")})`;
}

export function guardedBindingCreation(
  model: FeatureModel,
  feature: FeatureName,
  symbol: string,
  builtin: number,
  args: string[],
): string {
  return `Bun::createRemovableBinding<Bun::Feature::${featureConstantName(model, feature)}, ${symbol}, ${builtin}>(${args.join(", ")})`;
}

export function beginGuardedBody(
  model: FeatureModel,
  feature: FeatureName,
  stub: StubKind,
  resultType: string,
): string {
  return `BUN_BEGIN_REMOVABLE_ENTRY_POINT(${featureConstantName(model, feature)}, ${stub}, ${resultType})`;
}

export function hostFunctionDefinitionRecord(
  model: FeatureModel,
  feature: FeatureName,
  symbol: string,
  builtin?: number,
): string {
  const name = featureConstantName(model, feature);
  return builtin === undefined
    ? `BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(${name}, ${symbol});`
    : `BUN_REMOVABLE_BUILTIN_HOST_FUNCTION_DEFINITION(${name}, ${builtin}, ${symbol});`;
}

export const endGuardedBody = "BUN_END_REMOVABLE_ENTRY_POINT";
