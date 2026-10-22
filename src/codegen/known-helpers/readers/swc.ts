import { callbacksOfUnit, functionsOfUnit, readUnit, type FoundFunction } from "../definitions.ts";
import { isNameOfProbe, probes } from "../probes.ts";
import { readHelperFiles } from "./helper-files.ts";

export function readSwcHelpers(folder: string): FoundFunction[] {
  return readHelperFiles(folder, "@swc/helpers", ["src", "lib", "esm", "cjs"]);
}

export async function loadSwc(folder: string): Promise<(text: string, options: object) => { code: string }> {
  const loaded = await import(Bun.resolveSync("@swc/core", folder));
  return loaded.transformSync ?? loaded.default.transformSync;
}

interface Choice {
  readonly label: string;
  readonly parser?: object;
  readonly jsc?: object;
  readonly transform?: object;
  readonly module?: object;
}

const targets = ["es3", "es5", "es2015", "es2016", "es2017", "es2018", "es2019", "es2020", "es2021", "es2022", "es2023", "es2024", "esnext"];

const targetChoices: readonly Choice[] = targets.map(target => ({ label: `target: ${target}`, jsc: { target } }));
const moduleChoices: readonly Choice[] = ["commonjs", "es6"].map(type => ({ label: `module: ${type}`, module: { type } }));
const looseChoices: readonly Choice[] = [{ label: "" }, { label: "loose", jsc: { loose: true } }];
const classFieldChoices: readonly Choice[] = [
  { label: "" },
  { label: "useDefineForClassFields: true", transform: { useDefineForClassFields: true } },
  { label: "useDefineForClassFields: false", transform: { useDefineForClassFields: false } },
];
const decoratorChoices: readonly Choice[] = [
  { label: "decorators: legacy", transform: { legacyDecorator: true } },
  { label: "decorators: legacy with metadata", transform: { legacyDecorator: true, decoratorMetadata: true } },
  { label: "decorators: 2021-12", transform: { decoratorVersion: "2021-12" } },
  { label: "decorators: 2022-03", transform: { decoratorVersion: "2022-03" } },
  { label: "decorators: 2023-11", transform: { decoratorVersion: "2023-11" } },
];
const dynamicImportChoices: readonly Choice[] = [{ label: "", parser: { dynamicImport: true } }, { label: "" }];

function everyCombination(axes: readonly (readonly Choice[])[]): Choice[] {
  let combinations: Choice[] = [{ label: "" }];
  for (const axis of axes) {
    combinations = combinations.flatMap(left =>
      axis.map(right => ({
        label: [left.label, right.label].filter(label => label !== "").join(", "),
        parser: { ...left.parser, ...right.parser },
        jsc: { ...left.jsc, ...right.jsc },
        transform: { ...left.transform, ...right.transform },
        module: { ...left.module, ...right.module },
      })),
    );
  }
  return combinations;
}

export async function readSwc(folder: string): Promise<FoundFunction[]> {
  const transformSync = await loadSwc(folder);
  const found: FoundFunction[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    const axes = [targetChoices, moduleChoices, looseChoices, classFieldChoices];
    if (/decorat|auto-accessors/.test(probe.name)) axes.push(decoratorChoices);
    if (probe.text.includes("import(")) axes.push(dynamicImportChoices);
    for (const choice of everyCombination(axes)) {
      let code: string;
      try {
        code = transformSync(probe.text, {
          filename: `${probe.name}.${probe.hasJsx ? "tsx" : "ts"}`,
          swcrc: false,
          jsc: {
            parser: { syntax: "typescript", tsx: probe.hasJsx, decorators: true, ...choice.parser },
            transform: choice.transform,
            ...choice.jsc,
          },
          module: choice.module,
        }).code;
      } catch {
        continue;
      }
      if (seen.has(code)) continue;
      seen.add(code);
      const unit = readUnit(`${probe.name} (${choice.label})`, code);
      if (unit === undefined) continue;
      found.push(...functionsOfUnit(unit, name => !isNameOfProbe(name)));
      found.push(...callbacksOfUnit(unit, isNameOfProbe));
    }
  }
  return found;
}
