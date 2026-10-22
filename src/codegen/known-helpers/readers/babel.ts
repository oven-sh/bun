import path from "node:path";
import { callbacksOfUnit, functionsOfUnit, readUnit, type FoundFunction } from "../definitions.ts";
import { isNameOfProbe, probes, type Probe } from "../probes.ts";
import { readHelperFiles } from "./helper-files.ts";

export function readBabelRuntime(folder: string): FoundFunction[] {
  return readHelperFiles(folder, "@babel/runtime", ["helpers"]);
}

type Transform = (text: string, options: object) => Promise<{ code?: string | null } | null>;
type Plugin = readonly [file: string, options: object];

interface Feature {
  readonly packages: readonly string[];
  readonly takesLoose?: boolean;
  readonly isUsedBy?: (probe: Probe) => boolean;
}

const features: readonly Feature[] = [
  { packages: ["@babel/plugin-proposal-class-static-block", "@babel/plugin-transform-class-static-block"] },
  { packages: ["@babel/plugin-proposal-class-properties", "@babel/plugin-transform-class-properties"], takesLoose: true },
  { packages: ["@babel/plugin-proposal-private-methods", "@babel/plugin-transform-private-methods"], takesLoose: true },
  { packages: ["@babel/plugin-proposal-private-property-in-object", "@babel/plugin-transform-private-property-in-object"], takesLoose: true },
  { packages: ["@babel/plugin-proposal-export-namespace-from", "@babel/plugin-transform-export-namespace-from"] },
  {
    packages: ["@babel/plugin-proposal-explicit-resource-management", "@babel/plugin-transform-explicit-resource-management"],
    isUsedBy: probe => probe.name.startsWith("using-"),
  },
  { packages: ["@babel/plugin-transform-react-jsx"], isUsedBy: probe => probe.hasJsx },
];

const decoratorsPackages = ["@babel/plugin-proposal-decorators"];

const decoratorChoices: readonly (readonly [string, object])[] = [
  ["legacy", { legacy: true }],
  ["2018-09 before export", { decoratorsBeforeExport: true }],
  ["2018-09 after export", { decoratorsBeforeExport: false }],
  ["2021-12 before export", { version: "2021-12", decoratorsBeforeExport: true }],
  ["2021-12 after export", { version: "2021-12", decoratorsBeforeExport: false }],
  ["2022-03 before export", { version: "2022-03", decoratorsBeforeExport: true }],
  ["2022-03 after export", { version: "2022-03", decoratorsBeforeExport: false }],
  ["2023-01", { version: "2023-01" }],
  ["2023-05", { version: "2023-05" }],
  ["2023-11", { version: "2023-11" }],
];

const targets: readonly (readonly [string, object])[] = [
  ["ie 11", { ie: "11" }],
  ["node 6", { node: "6" }],
  ["node 8", { node: "8" }],
  ["node 10", { node: "10" }],
  ["node 12", { node: "12" }],
  ["node 14", { node: "14" }],
  ["node 18", { node: "18" }],
];

const withoutConfigurationFiles = { babelrc: false, configFile: false };

function resolveFrom(folder: string, name: string): string | undefined {
  try {
    return Bun.resolveSync(name, folder);
  } catch {
    return undefined;
  }
}

class Plugins {
  private readonly verdicts = new Map<string, boolean>();

  constructor(
    private readonly folder: string,
    private readonly transform: Transform,
  ) {}

  private async isAccepted(plugin: Plugin): Promise<boolean> {
    const key = JSON.stringify(plugin);
    let verdict = this.verdicts.get(key);
    if (verdict === undefined) {
      try {
        await this.transform("", { ...withoutConfigurationFiles, plugins: [plugin] });
        verdict = true;
      } catch {
        verdict = false;
      }
      this.verdicts.set(key, verdict);
    }
    return verdict;
  }

  async firstAccepted(packages: readonly string[], options: object): Promise<Plugin | undefined> {
    for (const name of packages) {
      const file = resolveFrom(this.folder, name);
      if (file !== undefined && (await this.isAccepted([file, options]))) return [file, options];
    }
    return undefined;
  }

  async forProbe(probe: Probe, loose: boolean, decorators: object | undefined): Promise<Plugin[] | undefined> {
    const plugins: Plugin[] = [];
    if (decorators !== undefined) {
      const plugin = await this.firstAccepted(decoratorsPackages, decorators);
      if (plugin === undefined) return undefined;
      plugins.push(plugin);
    }
    for (const feature of features) {
      if (feature.isUsedBy !== undefined && !feature.isUsedBy(probe)) continue;
      const plugin = await this.firstAccepted(feature.packages, loose && feature.takesLoose ? { loose } : {});
      if (plugin !== undefined) plugins.push(plugin);
    }
    return plugins;
  }
}

export async function readBabel(folder: string): Promise<FoundFunction[]> {
  const babel = await import(Bun.resolveSync("@babel/core", folder));
  const transform: Transform = babel.transformAsync ?? babel.default.transformAsync;
  const presetEnv = Bun.resolveSync("@babel/preset-env", folder);
  const plugins = new Plugins(folder, transform);
  const found: FoundFunction[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    if (probe.hasTypes) continue;
    const usesDecorators = /decorat|auto-accessors/.test(probe.name);
    for (const [decoratorsName, decorators] of usesDecorators ? decoratorChoices : [["", undefined] as const]) {
      for (const loose of [false, true]) {
        const pluginsOfProbe = await plugins.forProbe(probe, loose, decorators);
        if (pluginsOfProbe === undefined) continue;
        for (const [targetName, target] of targets) {
          for (const modules of ["commonjs", false] as const) {
            let code: string | undefined;
            try {
              const result = await transform(probe.text, {
                ...withoutConfigurationFiles,
                filename: path.join(folder, `${probe.name}.js`),
                sourceType: "module",
                comments: false,
                presets: [[presetEnv, loose ? { targets: target, modules, loose } : { targets: target, modules }]],
                plugins: pluginsOfProbe,
              });
              code = result?.code ?? undefined;
            } catch {
              continue;
            }
            if (code === undefined || seen.has(code)) continue;
            seen.add(code);
            const options = [`targets: ${targetName}`, `modules: ${modules}`];
            if (loose) options.push("loose");
            if (decoratorsName !== "") options.push(`decorators: ${decoratorsName}`);
            const unit = readUnit(`${probe.name} (${options.join(", ")})`, code);
            if (unit === undefined) continue;
            found.push(...functionsOfUnit(unit, name => !isNameOfProbe(name)));
            found.push(...callbacksOfUnit(unit, isNameOfProbe));
          }
        }
      }
    }
  }
  return found;
}
