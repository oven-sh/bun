import fs from "fs";
import path from "path";
import { readdirRecursive, resolveSyncOrNull } from "./helpers";

export function createInternalModuleRegistry(basedir: string) {
  const moduleList = ["bun", "node", "thirdparty", "internal"]
    .flatMap(dir => readdirRecursive(path.join(basedir, dir)))
    .filter(file => file.endsWith(".js") || (file.endsWith(".ts") && !file.endsWith(".d.ts")))
    .map(file => file.slice(basedir.length + 1))
    .map(x => x.replaceAll("\\", "/"))
    .sort();

  // Create the Internal Module Registry
  const internalRegistry = new Map();
  for (let i = 0; i < moduleList.length; i++) {
    const prefix = moduleList[i].startsWith("node/")
      ? "node:"
      : moduleList[i].startsWith("bun:")
        ? "bun:"
        : moduleList[i].startsWith("internal/")
          ? "internal/"
          : undefined;
    if (prefix) {
      const id = prefix + moduleList[i].slice(prefix.length).replaceAll(".", "/").slice(0, -3);
      internalRegistry.set(id, i);
    }
  }

  moduleList.push("internal-for-testing.ts");
  internalRegistry.set("bun:internal-for-testing", moduleList.length - 1);

  // Native Module registry
  const nativeModuleH = fs.readFileSync(path.join(basedir, "../bun.js/modules/_NativeModule.h"), "utf8");
  const nativeModuleDefine = nativeModuleH.match(/BUN_FOREACH_NATIVE_MODULE\(macro\)\s*\\\n((.*\\\n)*\n)/);
  if (!nativeModuleDefine) {
    throw new Error(
      "Could not find BUN_FOREACH_NATIVE_MODULE in _NativeModule.h. Knowing native module IDs is a part of the codegen process.",
    );
  }
  let nextNativeModuleId = 0;
  const nativeModuleIds: Record<string, number> = {};
  const nativeModuleEnums: Record<string, string> = {};
  const nativeModuleEnumToId: Record<string, number> = {};
  for (const [_, idString, enumValue] of nativeModuleDefine[0].matchAll(/macro\((.*?),(.*?)\)/g)) {
    const processedIdString = JSON.parse(idString.trim().replace(/_s$/, ""));
    const processedEnumValue = enumValue.trim();
    const processedNumericId = nextNativeModuleId++;
    nativeModuleIds[processedIdString] = processedNumericId;
    nativeModuleEnums[processedIdString] = processedEnumValue;
    nativeModuleEnumToId[processedEnumValue] = processedNumericId;
  }

  function codegenRequireId(id: string) {
    return `(__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, ${id}) || __intrinsic__createInternalModuleById(${id}))`;
  }

  function codegenRequireNativeModule(id: string) {
    return `(__intrinsic__requireNativeModule(${id.replace(/node:/, "")}))`;
  }

  const requireTransformer = (specifier: string, from: string) => {
    const directMatch = internalRegistry.get(specifier);
    if (directMatch) return codegenRequireId(`${directMatch}/*${specifier}*/`);

    if (specifier in nativeModuleIds) {
      return codegenRequireNativeModule(JSON.stringify(specifier));
    }

    const relativeMatch =
      resolveSyncOrNull(specifier, path.join(basedir, path.dirname(from))) ?? resolveSyncOrNull(specifier, basedir);

    if (relativeMatch) {
      const found = moduleList.indexOf(path.relative(basedir, relativeMatch).replaceAll("\\", "/"));
      if (found === -1) {
        throw new Error(
          `Builtin Bundler: "${specifier}" cannot be imported here because it doesn't get a module ID. Only files in "src/js" besides "src/js/builtins" can be used here. Note that the 'node:' or 'bun:' prefix is required here. `,
        );
      }
      return codegenRequireId(`${found}/*${path.relative(basedir, relativeMatch)}*/`);
    }

    throw new Error(`Builtin Bundler: Could not resolve "${specifier}" in ${from}.`);
  };

  return {
    requireTransformer,
    nativeModuleIds,
    nativeModuleEnums,
    nativeModuleEnumToId,
    internalRegistry,
    moduleList,
  } as const;
}
