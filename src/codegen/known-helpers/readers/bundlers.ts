import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { callbacksOfUnit, functionsOfUnit, readUnit, type FoundFunction } from "../definitions.ts";
import { bundleProbes, isNameOfProbe, probes, writeBundleProbe, type Probe } from "../probes.ts";
import { isFunction, type Node } from "../syntax.ts";

function functionsGivenTo(call: Node): Node[] {
  const given: Node[] = [];
  for (const argument of call.arguments) {
    if (isFunction(argument)) given.push(argument);
    if (argument.type !== "ObjectExpression") continue;
    for (const property of argument.properties) {
      if (property.type === "ObjectMethod") given.push(property);
      else if (property.type === "ObjectProperty" && isFunction(property.value)) given.push(property.value);
    }
  }
  return given;
}

function moduleWrappersIn(statements: readonly Node[]): Node[] {
  const wrappers: Node[] = [];
  for (const statement of statements) {
    if (statement.type === "ExpressionStatement") {
      const expression: Node = statement.expression;
      const wrapper: Node = expression.type === "CallExpression" ? expression.callee : expression;
      if (isFunction(wrapper)) wrappers.push(wrapper);
    } else if (statement.type === "VariableDeclaration") {
      for (const { init } of statement.declarations) {
        if (init?.type === "CallExpression" && init.callee.type === "Identifier") wrappers.push(...functionsGivenTo(init));
      }
    }
  }
  return wrappers.filter(wrapper => wrapper.body.type === "BlockStatement");
}

function moduleScopesIn(statements: readonly Node[]): (readonly Node[])[] {
  return [statements, ...moduleWrappersIn(statements).flatMap(wrapper => moduleScopesIn(wrapper.body.body))];
}

class Collector {
  readonly found: FoundFunction[] = [];
  private readonly seen = new Set<string>();

  read(where: string, text: string | undefined): void {
    if (text === undefined || this.seen.has(text)) return;
    this.seen.add(text);
    const unit = readUnit(where, text, program => moduleScopesIn(program.body));
    if (unit === undefined) return;
    this.found.push(...functionsOfUnit(unit, name => !isNameOfProbe(name)));
    this.found.push(...callbacksOfUnit(unit, isNameOfProbe));
  }
}

function everyCombination(axes: Record<string, readonly unknown[]>): Record<string, unknown>[] {
  let combinations: Record<string, unknown>[] = [{}];
  for (const [name, values] of Object.entries(axes)) {
    combinations = combinations.flatMap(combination => values.map(value => (value === undefined ? combination : { ...combination, [name]: value })));
  }
  return combinations;
}

function describeOptions(options: Record<string, unknown>): string {
  return Object.entries(options)
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .join(", ");
}

async function inWorkFolder<T>(parent: string, use: (work: string) => T | Promise<T>): Promise<T> {
  const work = mkdtempSync(path.join(parent, "known-helpers-"));
  try {
    return await use(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function withSilentConsole<T>(run: () => Promise<T>): Promise<T> {
  const { log, info, warn } = console;
  console.log = console.info = console.warn = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, { log, info, warn });
  }
}

function writeSyntaxProbe(probe: Probe, folder: string, otherFiles: readonly (readonly [string, string])[] = []): string {
  const file = `${probe.name}.${probe.hasJsx ? "tsx" : "ts"}`;
  return writeBundleProbe({ name: probe.name, files: [[file, probe.text], ...otherFiles] }, folder);
}

const usesDecorators = (probe: Probe) => /decorat|auto-accessors/.test(probe.name);
const isExternal = (id: string) => id.startsWith("probe-external-");
const isOutsideOfSyntaxProbe = (id: string) => id.startsWith("./probe-") || id.startsWith("react/");

export async function readRollup(folder: string): Promise<FoundFunction[]> {
  const loaded = await import(Bun.resolveSync("rollup", folder));
  const rollup = loaded.rollup ?? loaded.default.rollup;
  const collector = new Collector();
  const outputs = everyCombination({
    format: ["cjs"],
    exports: ["named"],
    interop: [undefined, true, false, "auto", "esModule", "default", "defaultOnly", "compat"],
    generatedCode: [undefined, "es5", "es2015", { preset: "es5", symbols: true }, { preset: "es2015", symbols: true }],
    preferConst: [undefined, true],
    externalLiveBindings: [undefined, false],
    freeze: [undefined, false],
    namespaceToStringTag: [undefined, true],
  });
  await inWorkFolder(tmpdir(), async work => {
    for (const probe of bundleProbes) {
      const input = writeBundleProbe(probe, path.join(work, probe.name));
      let bundle: any;
      try {
        bundle = await rollup({ input, external: isExternal, onwarn() {} });
      } catch {
        continue;
      }
      for (const output of outputs) {
        try {
          const generated = await bundle.generate(output);
          for (const chunk of generated.output ?? [generated]) collector.read(`${probe.name} (${describeOptions(output)})`, chunk.code);
        } catch {}
      }
      await bundle.close?.();
    }
  });
  return collector.found;
}

const compressOnly = { compress: true, mangle: false, codegen: false };

export async function readRolldown(folder: string): Promise<FoundFunction[]> {
  const loaded = await import(Bun.resolveSync("rolldown", folder));
  const rolldown = loaded.rolldown ?? loaded.default.rolldown;
  const collector = new Collector();

  const build = async (where: string, input: object, output: object) => {
    try {
      const bundle = await rolldown({ logLevel: "silent", ...input });
      try {
        const generated = await bundle.generate(output);
        for (const chunk of generated.output) collector.read(where, chunk.code);
      } finally {
        await bundle.close?.();
      }
    } catch {}
  };

  const bundleInputs = everyCombination({ platform: ["node", "neutral", "browser"], profilerNames: [undefined, true, false] });
  const bundleOutputs = everyCombination({
    format: ["esm", "cjs"],
    exports: ["named"],
    generatedCode: [undefined, { profilerNames: true }, { profilerNames: false }],
    minify: [undefined, "dce-only", compressOnly],
    externalLiveBindings: [undefined, false],
  });
  const syntaxOutputs = everyCombination({ format: ["esm"], minify: [undefined, compressOnly] });
  const syntaxTransformsOf = (probe: Probe) =>
    everyCombination({
      decorator: usesDecorators(probe) ? [undefined, { legacy: true, emitDecoratorMetadata: true }] : [undefined],
      target: ["es2015", "es2016", "es2017", "es2018", "es2019", "es2020", "es2021", "es2022", "esnext"],
    });

  await inWorkFolder(folder, work =>
    withSilentConsole(async () => {
      for (const probe of bundleProbes) {
        const input = writeBundleProbe(probe, path.join(work, probe.name));
        for (const inputOptions of bundleInputs) {
          for (const output of bundleOutputs) {
            if ("profilerNames" in inputOptions && "generatedCode" in output) continue;
            const where = `${probe.name} (${describeOptions({ ...inputOptions, ...output })})`;
            await build(where, { input, external: isExternal, ...inputOptions }, output);
          }
        }
      }
      for (const probe of probes) {
        const input = writeSyntaxProbe(probe, path.join(work, "syntax"));
        for (const transform of syntaxTransformsOf(probe)) {
          for (const output of syntaxOutputs) {
            const where = `${probe.name} (${describeOptions({ ...transform, ...output })})`;
            await build(where, { input, external: isOutsideOfSyntaxProbe, platform: "node", transform }, output);
          }
        }
      }
    }),
  );
  return collector.found;
}

interface BunEntry {
  readonly name: string;
  readonly file: string;
  readonly flags: readonly string[];
  readonly settings: readonly string[];
}

const experimentalDecorators = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });

function writeBunEntries(work: string): BunEntry[] {
  const entries: BunEntry[] = [];
  for (const probe of bundleProbes) {
    entries.push({ name: probe.name, file: writeBundleProbe(probe, path.join(work, probe.name)), flags: ["--external=probe-external-*"], settings: [] });
  }
  const flags = ["--external=./probe-*", "--external=react/*"];
  for (const probe of probes) {
    entries.push({ name: probe.name, file: writeSyntaxProbe(probe, path.join(work, "syntax")), flags, settings: [] });
    if (!usesDecorators(probe)) continue;
    const file = writeSyntaxProbe(probe, path.join(work, "experimental-decorators"), [["tsconfig.json", experimentalDecorators]]);
    entries.push({ name: probe.name, file, flags, settings: ["tsconfig.json: experimentalDecorators, emitDecoratorMetadata"] });
  }
  return entries;
}

export function readBun(folder: string): Promise<FoundFunction[]> {
  const binary = path.join(folder, "bin/bun");
  const collector = new Collector();
  const styles: readonly (readonly string[])[] = [[], ["--minify-syntax"]];
  return inWorkFolder(tmpdir(), work => {
    const entries = writeBunEntries(work);
    for (const style of styles) {
      for (const format of ["esm", "cjs"]) {
        for (const target of ["node", "bun", "browser"]) {
          for (const entry of entries) {
            const flags = [`--format=${format}`, `--target=${target}`, ...style, ...entry.flags];
            const result = Bun.spawnSync([binary, "build", entry.file, ...flags], { cwd: work, stdout: "pipe", stderr: "ignore", env: { PATH: "", HOME: work } });
            if (result.exitCode === 0) collector.read(`${entry.name} (${[flags.join(" "), ...entry.settings].join("; ")})`, result.stdout.toString());
          }
        }
      }
    }
    return collector.found;
  });
}
