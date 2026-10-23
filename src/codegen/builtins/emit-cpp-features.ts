import { Problems } from "./declarations.ts";
import { namedBuiltinsOf } from "./emit-cpp-names.ts";
import { emitMacroList, joinBlocks } from "./emit-cpp-support.ts";
import { fileHeader } from "./emit-rust-ids.ts";
import type { ModelBuiltin, TableFeature, TableModel } from "./model.ts";
import { compareBytes } from "./paths.ts";
import type { BuiltinKind, FeatureName } from "./vocabulary.ts";

type StubKind = "Throw";

interface GuardedSymbol {
  symbol: string;
  feature: FeatureName;
  stub: StubKind;
  builtin: ModelBuiltin;
}

function stubOfKind(kind: BuiltinKind): StubKind | null {
  switch (kind) {
    case "Constructor":
    case "Function":
    case "Method":
    case "Accessor":
    case "NativeBinding":
      return "Throw";
    case "Namespace":
    case "Prototype":
    case "DataProperty":
    case "Constant":
      return null;
  }
}

function findGuardedSymbols(
  builtin: ModelBuiltin,
  engineFeatures: ReadonlySet<FeatureName>,
  problems: Problems,
): GuardedSymbol[] {
  if (builtin.origin !== "Engine") return [];
  const guard = builtin.attachments.featureUses.find(use => use.isGuard);
  const stub = stubOfKind(builtin.kind);
  if (guard === undefined || stub === null) return [];
  const { feature } = guard;
  if (!engineFeatures.has(feature)) {
    problems.add(null, `${builtin.text} is an engine entry guarded by ${feature}, which is not an engine feature`);
    return [];
  }
  return builtin.attachments.nativeSymbols.map(symbol => ({ symbol, feature, stub, builtin }));
}

function compareGuardedSymbols(left: GuardedSymbol, right: GuardedSymbol): number {
  return compareBytes(left.symbol, right.symbol) || left.builtin.id - right.builtin.id;
}

function isFirstWithSymbol(guarded: GuardedSymbol, index: number, sorted: readonly GuardedSymbol[]): boolean {
  return index === 0 || sorted[index - 1].symbol !== guarded.symbol;
}

export function emitCppFeatures(model: TableModel, features: readonly TableFeature[]): string {
  const engineFeatures = features.filter(feature => feature.isEngine).sort((left, right) => left.index - right.index);
  const engineFeatureNames = new Set(engineFeatures.map(feature => feature.name));
  const problems = new Problems();
  const guardedSymbols = model.builtins
    .flatMap(builtin => findGuardedSymbols(builtin, engineFeatureNames, problems))
    .sort(compareGuardedSymbols)
    .filter(isFirstWithSymbol);
  problems.throwIfAny();
  // Code of the engine records the position of the entry in the engine's list of names. It does not know the number that the table gives it.
  const positions = new Map(namedBuiltinsOf(model).map((builtin, position) => [builtin, position]));
  const formatGuardedSymbol = ({ symbol, feature, stub, builtin }: GuardedSymbol): string =>
    `${symbol}, ${feature}, ${stub}, ${positions.get(builtin)}`;
  const blocks = [
    `${fileHeader}#pragma once`,
    emitMacroList(
      "FOR_EACH_ENGINE_REMOVABLE_FEATURE",
      engineFeatures.map(({ name, index }) => `${name}, ${index}`),
    ),
    emitMacroList("FOR_EACH_GUARDED_ENGINE_SYMBOL", guardedSymbols.map(formatGuardedSymbol)),
    `namespace JSC {\ninline constexpr unsigned numberOfEngineRemovableFeatures = ${engineFeatures.length};\n}`,
  ];
  return `${joinBlocks(blocks)}\n`;
}
