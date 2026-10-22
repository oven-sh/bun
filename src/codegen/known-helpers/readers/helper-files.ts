import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { exportOf, functionsOfUnit, readUnit, type FoundFunction, type Unit } from "../definitions.ts";

function filesUnder(folder: string, extensions: readonly string[]): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .sort()
    .flatMap(name => {
      const full = path.join(folder, name);
      if (statSync(full).isDirectory()) return filesUnder(full, extensions);
      return extensions.some(extension => name.endsWith(extension)) ? [full] : [];
    });
}

export function readHelperFiles(root: string, packageName: string, folders: readonly string[]): FoundFunction[] {
  const units = new Map<string, Unit | undefined>();
  const extensions = [".js", ".mjs", ".cjs"];

  const load = (file: string): Unit | undefined => {
    if (units.has(file)) return units.get(file);
    const unit = readUnit(path.relative(root, file), readFileSync(file, "utf8"));
    units.set(file, unit);
    if (unit === undefined) return undefined;
    unit.resolveImport = imported => {
      const isOwn = imported.source.startsWith(`${packageName}/`);
      if (!isOwn && !imported.source.startsWith(".")) return undefined;
      const base = isOwn ? path.join(root, imported.source.slice(packageName.length + 1)) : path.resolve(path.dirname(file), imported.source);
      const target = [base, ...extensions.map(extension => base + extension)].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      const targetUnit = target === undefined ? undefined : load(target);
      return targetUnit && exportOf(targetUnit, imported.name);
    };
    return unit;
  };

  const found: FoundFunction[] = [];
  for (const folder of folders) {
    for (const file of filesUnder(path.join(root, folder), extensions)) {
      const unit = load(file);
      if (unit !== undefined) found.push(...functionsOfUnit(unit, () => true));
    }
  }
  return found;
}
