import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { callbacksOfUnit, functionsOfUnit, readUnit, type FoundFunction, type Unit } from "../definitions.ts";
import { bundleProbes, isNameOfProbe, probes, writeBundleProbe, type BundleProbe, type Probe } from "../probes.ts";

type Style = readonly string[];

interface Output {
  readonly where: string;
  readonly text: string | undefined;
}

const targets = ["es2015", "es2016", "es2017", "es2018", "es2019", "es2020", "es2021", "es2022", "esnext", "es5"];
const formats = ["cjs", "esm"];
const platforms = ["node", "browser", "neutral"];

const shortensNames = "--minify-identifiers";
const stylesThatKeepNames: readonly Style[] = [[], ["--minify-syntax"], ["--keep-names"]];
const stylesThatShortenNames: readonly Style[] = [[shortensNames], ["--minify-syntax", shortensNames]];

const experimentalDecorators = `--tsconfig-raw={"compilerOptions":{"experimentalDecorators":true}}`;

function run(binary: string, flags: readonly string[], input: string | undefined, cwd: string): string | undefined {
  const result = Bun.spawnSync([binary, ...flags, "--log-level=error"], {
    cwd,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

function describe(probeName: string, style: Style, flags: readonly string[]): string {
  return [probeName, ...style, ...flags].join(" ");
}

function forEachBuild(styles: readonly Style[], visit: (style: Style, target: string, format: string) => void): void {
  for (const style of styles) {
    for (const target of targets) {
      for (const format of formats) visit(style, target, format);
    }
  }
}

function withoutTreesOf(others: readonly FoundFunction[], functions: readonly FoundFunction[]): FoundFunction[] {
  const trees = new Set(others.map(one => one.tree));
  return functions.filter(one => !trees.has(one.tree));
}

function publishedNamesOf(functions: readonly FoundFunction[]): string[] {
  return [...new Set(functions.map(one => one.publishedName))];
}

const nameInRuntimeOfCompactForm = (nameOfVerboseForm: string) => `${nameOfVerboseForm}Min`;

function compactFormsIn(shortened: Unit, named: Unit): FoundFunction[] {
  const shortenedFunctions = functionsOfUnit(shortened, () => true);
  const namedFunctions = functionsOfUnit(named, () => true);
  const compact = withoutTreesOf(namedFunctions, shortenedFunctions);
  const verbose = withoutTreesOf(shortenedFunctions, namedFunctions).filter(one => !isNameOfProbe(one.publishedName));
  const shortNames = publishedNamesOf(compact);
  const verboseNames = publishedNamesOf(verbose);
  if (shortNames.length !== verboseNames.length) return compact;
  return compact.map(one => ({
    ...one,
    publishedName: nameInRuntimeOfCompactForm(verboseNames[shortNames.indexOf(one.publishedName)]),
  }));
}

export function readEsbuild(folder: string): FoundFunction[] {
  const binary = path.join(folder, "bin/esbuild");
  const work = mkdtempSync(path.join(tmpdir(), "known-helpers-"));
  const found: FoundFunction[] = [];
  const seen = new Set<string>();
  const bundles = new Map<string, string | undefined>();
  const entries = new Map(
    bundleProbes.map(probe => [probe, writeBundleProbe(probe, path.join(work, probe.name))] as const),
  );

  const read = ({ where, text }: Output) => {
    if (text === undefined || seen.has(text)) return;
    seen.add(text);
    const unit = readUnit(where, text);
    if (unit === undefined) return;
    found.push(...functionsOfUnit(unit, name => !isNameOfProbe(name)));
    found.push(...callbacksOfUnit(unit, isNameOfProbe));
  };

  const readCompactForms = (shortened: Output, named: Output) => {
    if (shortened.text === undefined || named.text === undefined || seen.has(shortened.text)) return;
    seen.add(shortened.text);
    const shortenedUnit = readUnit(shortened.where, shortened.text);
    const namedUnit = readUnit(named.where, named.text);
    if (shortenedUnit !== undefined && namedUnit !== undefined) found.push(...compactFormsIn(shortenedUnit, namedUnit));
  };

  const transform = (probe: Probe, language: "ts" | "js", style: Style, target: string, format: string) => {
    const hasTwoKindsOfDecorators = language === "ts" && /decorat/.test(probe.name);
    for (const decorators of hasTwoKindsOfDecorators ? [[experimentalDecorators], []] : [[]]) {
      const flags = [
        `--loader=${language}${probe.hasJsx ? "x" : ""}`,
        `--format=${format}`,
        `--target=${target}`,
        ...decorators,
      ];
      read({ where: describe(probe.name, style, flags), text: run(binary, [...flags, ...style], probe.text, work) });
    }
  };

  const bundle = (probe: BundleProbe, style: Style, target: string, format: string, platform: string): Output => {
    const flags = [
      "--bundle",
      `--format=${format}`,
      `--target=${target}`,
      `--platform=${platform}`,
      "--external:probe-external-*",
    ];
    const where = describe(probe.name, style, flags);
    if (!bundles.has(where))
      bundles.set(where, run(binary, [entries.get(probe)!, ...flags, ...style], undefined, work));
    return { where, text: bundles.get(where) };
  };

  forEachBuild(stylesThatKeepNames, (style, target, format) => {
    for (const probe of probes) transform(probe, "ts", style, target, format);
    for (const probe of bundleProbes) {
      for (const platform of platforms) read(bundle(probe, style, target, format, platform));
    }
  });
  forEachBuild(stylesThatKeepNames, (style, target, format) => {
    for (const probe of probes) if (!probe.hasTypes) transform(probe, "js", style, target, format);
  });
  forEachBuild(stylesThatShortenNames, (style, target, format) => {
    const styleThatKeepsNames = style.filter(flag => flag !== shortensNames);
    for (const probe of bundleProbes) {
      for (const platform of platforms) {
        readCompactForms(
          bundle(probe, style, target, format, platform),
          bundle(probe, styleThatKeepsNames, target, format, platform),
        );
      }
    }
  });

  rmSync(work, { recursive: true, force: true });
  return found;
}
