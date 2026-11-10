// Generates random module graphs of 4 to 10 files that mix CommonJS and ES modules. The graphs are acyclic: a file imports only files with a higher index.
// Each module exports one string built from the strings it imports. Only the entry prints, so the output does not depend on timing.
// The program number is the random seed, so a number always produces the same program. The number also selects a variant of the same million graphs:
//   0         static imports and require() only
//   1,000,000 plus dynamic imports: an import() inside a function that is never called, or one started during evaluation. The entry prints their sorted results on a second line.
//   2,000,000 plus re-exports: export *, export { x } from, or a property copied in a CommonJS module. Importers also read the re-exported name.
//   3,000,000 plus both
//   4,000,000 to 7,000,000 repeat these four with tree shaking: package.json says "sideEffects": false, and some imports are unused or are read only in a function that is never called.
//             Some modules export a function, never called, that loads one of their importers. The entry may load a module behind a false condition or with await import().
//   8,000,000 to 11,000,000 repeat the four variants that have re-exports (2, 3, 6 and 7 million) with renaming: export { x as y } from, or a property copied under another name.
//             There the function that is never called may load any module that reaches its own module, not only a direct importer.
//   12,000,000 and 13,000,000 repeat 10 and 11 million with modules that the build cannot compile: a syntax error that is loaded only by a function that is never called, or a type error, which
//             Bun runs, in a module of which no name is read. Whether the build stops is compared between two builds of Bun: a build that newly stops is a regression.
//
//   bun write-random-module-graph-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<files>-files--<commonjs>-commonjs--<imports>-imports--<entry>.mjs or .cjs
//   bun write-random-module-graph-sweep.ts count
//   bun write-random-module-graph-sweep.ts named <pattern> <folder> [limit]
import { mkdirSync, writeFileSync } from "fs";

const graphsPerVariant = 1_000_000;
const total = 14 * graphsPerVariant;

function createRandom(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  return { below: (end: number) => Math.floor(next() * end), chance: (of: number) => next() < of };
}

const builtinModules = ["node:crypto", "node:os", "node:path", "node:events"];

function write(seed: number): { name: string; text: string } {
  const random = createRandom(seed % graphsPerVariant);
  const group = Math.floor(seed / graphsPerVariant);
  const hasRenamedReexports = group >= 8;
  const variant = hasRenamedReexports ? [2, 3, 6, 7, 6, 7][group - 8] : group;
  const brokenRandom = group >= 12 ? createRandom(seed % graphsPerVariant ^ 0x7f4a7c15) : undefined;
  let brokenModuleCount = 0;
  const dynamicImportRandom =
    variant & 1 ? createRandom((graphsPerVariant + (seed % graphsPerVariant)) ^ 0x5bd1e995) : undefined;
  const reexportRandom = variant & 2 ? createRandom(seed % graphsPerVariant ^ 0x2545f491) : undefined;
  const treeShakingRandom = variant & 4 ? createRandom(seed % graphsPerVariant ^ 0x1b873593) : undefined;
  let dynamicImportCount = 0;
  let unusedImportCount = 0;
  let lazyCycleCount = 0;
  let hasTopLevelAwait = false;
  const count = 4 + random.below(7);
  const isCommonJS = Array.from({ length: count }, () => random.chance(0.5));
  const fileName = (index: number) => (index === 0 ? "main" : "m" + index) + (isCommonJS[index] ? ".cjs" : ".mjs");
  // Each file imports up to three later files, and every file but the entry is imported by an earlier file.
  const imports: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let index = 0; index < count - 1; index++)
    for (let remaining = random.below(4); remaining > 0; remaining--)
      imports[index].add(index + 1 + random.below(count - index - 1));
  for (let index = 1; index < count; index++)
    if (!imports.some(set => set.has(index))) imports[random.below(index)].add(index);
  // In the renamed groups, modules that only re-export and have no name of their own.
  const isPureBarrel: boolean[] = imports.map(() => false);
  if (hasRenamedReexports)
    for (let index = count - 1; index > 0; index--)
      isPureBarrel[index] =
        !isCommonJS[index] &&
        imports[index].size > 0 &&
        ![...imports[index]].some(target => isPureBarrel[target]) &&
        reexportRandom!.chance(0.35);
  // The imports that each file re-exports, and the syntax. Re-exports are read one level up: a direct importer reads the name from the re-exporting file.
  const reexports: [number, number][][] = imports.map((set, index) => {
    if (index === 0 || !reexportRandom) return [];
    if (isPureBarrel[index]) return [...set].map(target => [target, 0]);
    return [...set]
      .filter(target => reexportRandom.chance(0.4) && !isPureBarrel[target])
      .map(target => [target, reexportRandom.below(2)]);
  });
  // A star cannot rename.
  const reexportedName = (reexporter: number, target: number, style: number) =>
    hasRenamedReexports && (isCommonJS[reexporter] || !style) ? `r${target}` : `t${target}`;
  const files = imports.map((set, index) => {
    const lines: string[] = [];
    const parts: string[] = [];
    const trailingLines: string[] = [];
    const unusedParts: string[] = [];
    const writeBrokenModule = () => {
      if (!brokenRandom?.chance(0.1)) return;
      brokenModuleCount++;
      const style = isCommonJS[index] ? 0 : brokenRandom.below(3);
      if (style === 0)
        trailingLines.push(
          isCommonJS[index]
            ? `module.exports.broken${index} = () => import("./broken.mjs");`
            : `export const broken${index} = () => import("./broken.mjs");`,
        );
      else if (style === 1) lines.push(`import { wrongType as wrong${index} } from "./wrong-type.ts";`);
      else lines.push(`export { wrongType as wrong${index} } from "./wrong-type.ts";`);
    };
    for (const [target, style] of reexports[index]) {
      if (isCommonJS[index])
        trailingLines.push(
          `module.exports.${reexportedName(index, target, style)} = require("./${fileName(target)}").t${target};`,
        );
      else
        lines.push(
          style
            ? `export * from "./${fileName(target)}";`
            : `export { t${target}${hasRenamedReexports ? " as " + reexportedName(index, target, style) : ""} } from "./${fileName(target)}";`,
        );
    }
    if (isPureBarrel[index]) {
      writeBrokenModule();
      return [...lines, ...trailingLines].join("\n");
    }
    for (const target of [...set].sort((a, b) => (random.chance(0.2) ? b - a : a - b))) {
      const [from, text] = [`"./${fileName(target)}"`, "t" + target];
      const style = random.below(4);
      const reexportedNames = reexports[target].map(([name, style]) => [name, reexportedName(target, name, style)]);
      // In the renamed groups an ES module may only re-export from the file, and an importer may read only the renamed names.
      const isReexported = reexports[index].some(([name]) => name === target);
      if (hasRenamedReexports && !isCommonJS[index] && isReexported && reexportRandom!.chance(0.6)) continue;
      const readNames = isPureBarrel[target]
        ? []
        : hasRenamedReexports && reexportedNames.length && reexportRandom!.chance(0.5)
          ? []
          : [text];
      const isUnused = treeShakingRandom?.chance(0.35) ?? false;
      if (isUnused) unusedImportCount++;
      const reads = isUnused ? unusedParts : parts;
      const pushMemberReads = (of: string) =>
        reads.push(
          ...readNames.map(name => `${of}.${name}`),
          ...reexportedNames.map(([, exported]) => `${of}.${exported}`),
        );
      const bindingList = (as: string) =>
        [...readNames, ...reexportedNames.map(([name, exported]) => `${exported}${as}h${target}_${name}`)].join(", ");
      const pushBindingReads = () => reads.push(...readNames, ...reexportedNames.map(([name]) => `h${target}_${name}`));
      if (isCommonJS[index]) {
        if (style === 0) (lines.push(`const { ${bindingList(": ")} } = require(${from});`), pushBindingReads());
        else (lines.push(`const r${target} = require(${from});`), pushMemberReads("r" + target));
      } else if (index === 0 && treeShakingRandom?.chance(0.3))
        (lines.push(`const n${target} = await import(${from});`),
          pushMemberReads("n" + target),
          (hasTopLevelAwait = true));
      else if (style === 0 && index === 0) lines.push(`import ${from};`);
      else if (style === 1) (lines.push(`import * as n${target} from ${from};`), pushMemberReads("n" + target));
      else if (isCommonJS[target] && style === 2)
        (lines.push(`import r${target} from ${from};`), pushMemberReads("r" + target));
      else (lines.push(`import { ${bindingList(" as ")} } from ${from};`), pushBindingReads());
    }
    if (random.chance(0.15)) {
      const builtinModule = builtinModules[random.below(builtinModules.length)];
      lines.push(
        isCommonJS[index]
          ? `const b${index} = require("${builtinModule}");`
          : `import b${index} from "${builtinModule}";`,
      );
      parts.push(`typeof b${index}`);
    }
    if (index > 0) writeBrokenModule();
    if (unusedParts.length && treeShakingRandom!.chance(0.5))
      lines.push(`function unused${index}() {\n  return [${unusedParts.join(", ")}].join();\n}`);
    if (index === 0 && treeShakingRandom?.chance(0.6)) {
      const from = `"./${fileName(1 + treeShakingRandom.below(count - 1))}"`;
      lines.push(`if (process.argv[2] === "never") ${isCommonJS[0] ? `require(${from})` : `await import(${from})`};`);
      hasTopLevelAwait ||= !isCommonJS[0];
    }
    const importers = imports.flatMap((importerSet, importer) => (importerSet.has(index) ? [importer] : []));
    // In the renamed groups the load may go to a module that reaches this one through others, such as the importer of a module that re-exports from this one.
    const ancestors = new Set(importers);
    if (hasRenamedReexports)
      for (let importer = index - 1; importer >= 0; importer--)
        if ([...imports[importer]].some(target => ancestors.has(target))) ancestors.add(importer);
    const lazyTargets = [...ancestors].sort((a, b) => a - b);
    if (index > 0 && treeShakingRandom?.chance(0.35)) {
      lazyCycleCount++;
      const importer = lazyTargets[treeShakingRandom.below(lazyTargets.length)];
      const from = `"./${fileName(importer)}"`;
      // The bundler rejects a require() of a module that uses top-level await, and only the entry uses it.
      const load = importer === 0 && hasTopLevelAwait ? "import" : "require";
      trailingLines.push(
        isCommonJS[index]
          ? `module.exports.late${index} = function () {\n  return ${load}(${from});\n};`
          : `export const late${index} = () => import(${from});`,
      );
    }
    if (dynamicImportRandom?.chance(0.35)) {
      dynamicImportCount++;
      const style = index === count - 1 ? 2 : dynamicImportRandom.below(3);
      const from =
        style === 2 ? '"node:os"' : `"./${fileName(index + 1 + dynamicImportRandom.below(count - index - 1))}"`;
      // A module that tree shaking removes must have no visible effect, so there only the entry starts an import() during evaluation.
      if (style === 0 || (treeShakingRandom && index > 0))
        (lines.push(`const later${index} = () => import(${from});`), parts.push(`typeof later${index}`));
      else lines.push(`(globalThis.waits ??= []).push(import(${from}).then(names => "m${index}>" + Object.keys(names).sort().slice(0, 3).join("+")));`); // prettier-ignore
    }
    const exportedValue = parts.length
      ? `"${index ? "m" + index : "end "}(" + [${parts.join(", ")}].join() + ")"`
      : `"m${index}"`;
    if (index === 0) lines.push(`console.log(${exportedValue});`);
    if (index === 0 && dynamicImportRandom) lines.push('Promise.all(globalThis.waits ?? []).then(all => console.log("later (" + all.sort().join() + ")"));'); // prettier-ignore
    if (index === 0) return lines.join("\n");
    if (!isCommonJS[index]) lines.push(`export const t${index} = ${exportedValue};`);
    else
      lines.push(
        random.chance(0.3)
          ? `module.exports = { t${index}: ${exportedValue} };`
          : `exports.t${index} = ${exportedValue};`,
      );
    return [...lines, ...trailingLines].join("\n");
  });
  const importCount = imports.reduce((sum, set) => sum + set.size, 0);
  return {
    name: `${count}-files--${isCommonJS.filter(Boolean).length}-commonjs--${importCount}-imports--${dynamicImportRandom ? dynamicImportCount + "-dynamic-imports--" : ""}${reexportRandom ? `${reexports.flat().length}-${hasRenamedReexports ? "renamed-" : ""}reexports--` : ""}${treeShakingRandom ? `${unusedImportCount}-unused-imports--${lazyCycleCount}-lazy-cycles--` : ""}${brokenRandom ? brokenModuleCount + "-broken-modules--" : ""}${isCommonJS[0] ? "cjs-entry.cjs" : "esm-entry.mjs"}`,
    text:
      [
        `// @entry: ./${fileName(0)}`,
        files[0],
        ...files.slice(1).flatMap((text, index) => [`// @filename: ./${fileName(index + 1)}`, text]),
        ...(brokenRandom
          ? [
              "// @filename: ./broken.mjs",
              "export const = ;",
              "// @filename: ./wrong-type.ts",
              'export const wrongType: number = "text";',
            ]
          : []),
        ...(treeShakingRandom
          ? ["// @filename: ./package.json", '{ "name": "app", "version": "1.0.0", "sideEffects": false }']
          : []),
      ].join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else if (process.argv[2] === "named") {
  const [pattern, folder, limit] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let index = 0; index < total && written < limit; index++) {
    const program = write(index);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
