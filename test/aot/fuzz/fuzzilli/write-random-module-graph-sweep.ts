// Generates random module graphs of 4 to 10 files that mix CommonJS and ES modules. The graphs are acyclic: a file imports only files with a higher index.
// Each module exports one string built from the strings it imports. Only the entry prints, so the output does not depend on timing.
// The program number is the random seed, so a number always produces the same program. The number also selects a variant of the same million graphs:
//   0         static imports and require() only
//   1,000,000 plus dynamic imports: an import() inside a function that is never called, or one started during evaluation. The entry prints their sorted results on a second line.
//   2,000,000 plus re-exports: export *, export { x } from, or a property copied in a CommonJS module. Importers also read the re-exported name.
//   3,000,000 plus both
//   4,000,000 to 7,000,000 repeat these four with tree shaking: package.json says "sideEffects": false, and some imports are unused or are read only in a function that is never called.
//             Some modules export a function, never called, that loads one of their importers. The entry may load a module behind a false condition or with await import().
//
//   bun write-random-module-graph-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<files>-files--<commonjs>-commonjs--<imports>-imports--<entry>.mjs or .cjs
//   bun write-random-module-graph-sweep.ts count
//   bun write-random-module-graph-sweep.ts named <pattern> <folder> [limit]
import { mkdirSync, writeFileSync } from "fs";

const graphsPerVariant = 1_000_000;
const total = 8 * graphsPerVariant;

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
  const variant = Math.floor(seed / graphsPerVariant);
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
  // The imports that each file re-exports, and the syntax. Re-exports are read one level up: a direct importer reads the name from the re-exporting file.
  const reexports: [number, number][][] = imports.map((set, index) =>
    index === 0 || !reexportRandom
      ? []
      : [...set].filter(() => reexportRandom.chance(0.4)).map(target => [target, reexportRandom.below(2)]),
  );
  const files = imports.map((set, index) => {
    const lines: string[] = [];
    const parts: string[] = [];
    const trailingLines: string[] = [];
    const unusedParts: string[] = [];
    for (const [target, style] of reexports[index]) {
      if (isCommonJS[index])
        trailingLines.push(`module.exports.t${target} = require("./${fileName(target)}").t${target};`);
      else
        lines.push(
          style ? `export * from "./${fileName(target)}";` : `export { t${target} } from "./${fileName(target)}";`,
        );
    }
    for (const target of [...set].sort((a, b) => (random.chance(0.2) ? b - a : a - b))) {
      const [from, text] = [`"./${fileName(target)}"`, "t" + target];
      const style = random.below(4);
      const reexportedNames = reexports[target].map(([name]) => name);
      const isUnused = treeShakingRandom?.chance(0.35) ?? false;
      if (isUnused) unusedImportCount++;
      const reads = isUnused ? unusedParts : parts;
      const pushMemberReads = (of: string) =>
        reads.push(`${of}.${text}`, ...reexportedNames.map(name => `${of}.t${name}`));
      const bindingList = (as: string) =>
        [text, ...reexportedNames.map(name => `t${name}${as}h${target}_${name}`)].join(", ");
      const pushBindingReads = () => reads.push(text, ...reexportedNames.map(name => `h${target}_${name}`));
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
    if (unusedParts.length && treeShakingRandom!.chance(0.5))
      lines.push(`function unused${index}() {\n  return [${unusedParts.join(", ")}].join();\n}`);
    if (index === 0 && treeShakingRandom?.chance(0.6)) {
      const from = `"./${fileName(1 + treeShakingRandom.below(count - 1))}"`;
      lines.push(`if (process.argv[2] === "never") ${isCommonJS[0] ? `require(${from})` : `await import(${from})`};`);
      hasTopLevelAwait ||= !isCommonJS[0];
    }
    const importers = imports.flatMap((importerSet, importer) => (importerSet.has(index) ? [importer] : []));
    if (index > 0 && treeShakingRandom?.chance(0.35)) {
      lazyCycleCount++;
      const importer = importers[treeShakingRandom.below(importers.length)];
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
    name: `${count}-files--${isCommonJS.filter(Boolean).length}-commonjs--${importCount}-imports--${dynamicImportRandom ? dynamicImportCount + "-dynamic-imports--" : ""}${reexportRandom ? reexports.flat().length + "-reexports--" : ""}${treeShakingRandom ? `${unusedImportCount}-unused-imports--${lazyCycleCount}-lazy-cycles--` : ""}${isCommonJS[0] ? "cjs-entry.cjs" : "esm-entry.mjs"}`,
    text:
      [
        `// @entry: ./${fileName(0)}`,
        files[0],
        ...files.slice(1).flatMap((text, index) => [`// @filename: ./${fileName(index + 1)}`, text]),
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
