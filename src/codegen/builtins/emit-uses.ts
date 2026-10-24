import type { BuiltinEntry, BuiltinFeatureUse, BuiltinKind, BuiltinUses } from "../../../scripts/build/trim/types.ts";
import { namedBuiltinsOf } from "./emit-cpp-names.ts";
import type { ModelBuiltin, ModelFeatureUse, ModelModule, TableModel } from "./model.ts";
import { isHiddenRootComponent } from "./paths.ts";
import type { FeatureName, TargetPlatform } from "./vocabulary.ts";

function findModulesByRoot(modules: readonly ModelModule[]): Map<ModelBuiltin, ModelModule> {
  return new Map(
    modules
      .filter(module => module.namespace.holder === null)
      .map((module): [ModelBuiltin, ModelModule] => [module.namespace, module]),
  );
}

function kindOf(builtin: ModelBuiltin, module: ModelModule | undefined): BuiltinKind {
  if (module === undefined) return builtin.kind;
  return module.isPublic ? "Module" : "InternalModule";
}

function usesOf(lines: readonly ModelFeatureUse[]): BuiltinFeatureUse[] {
  const entryLinesFirst = [
    ...lines.filter(line => line.overload === null),
    ...lines.filter(line => line.overload !== null),
  ];
  const isConditional = new Map<FeatureName, boolean>();
  for (const { feature, overload, condition } of entryLinesFirst) {
    const isConditionalLine = overload !== null || condition !== null;
    isConditional.set(feature, (isConditional.get(feature) ?? true) && isConditionalLine);
  }
  return Array.from(isConditional, ([feature, isConditionalUse]) => ({ feature, isConditional: isConditionalUse }));
}

export function builtinUsesOf(model: TableModel, target: TargetPlatform): BuiltinUses {
  const moduleOfRoot = findModulesByRoot(model.modules);
  const entries = model.builtins
    .filter(builtin => builtin.platforms.includes(target) && builtin.attachments.featureUses.length > 0)
    .map((builtin): BuiltinEntry => {
      const module = moduleOfRoot.get(builtin);
      const { featureUses, nativeSymbols, creationSymbol } = builtin.attachments;
      return {
        id: builtin.id,
        path: module === undefined ? builtin.text : module.specifier,
        kind: kindOf(builtin, module),
        uses: usesOf(featureUses),
        nativeSymbols: [...nativeSymbols],
        ...(creationSymbol === null ? {} : { creationSymbol }),
        hasHiddenRoot: isHiddenRootComponent(builtin.path[0]),
      };
    });
  return { entries, namedByEngine: namedBuiltinsOf(model).map(({ id }) => id) };
}
