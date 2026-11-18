/**
 * The `--order-hints` step of the build: writes a link's order file from hint lists (hints.ts) and the names the
 * link's inputs define, so the file matches the link whichever build or target the hints were traced on.
 *
 *   resolve.ts <llvm-nm> <llvm-cxxfilt> <elf|macho> <file listing the inputs> <order file> <hints>...
 *
 * Under LTO the names given at link time (`.llvm.<n>`) are not known yet, and lld's ELF port leaves those unordered.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { promisify } from "node:util";
import { demangleRust, hintNames, readHintList, resolveHints, type ObjectFormat } from "./generate.ts";

const INPUTS_PER_RUN = 100;

async function functionNames(nm: string, inputs: string[]): Promise<Set<string>> {
  const names = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const args = ["--defined-only", "--no-sort", "--format=posix", ...inputs.slice(next, (next += INPUTS_PER_RUN))];
      const { stdout } = await promisify(execFile)(nm, args, { maxBuffer: 1 << 30 });
      for (const [, name] of stdout.matchAll(/^(\S+) [tTW] /gm)) names.add(name!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, availableParallelism()) }, worker));
  return names;
}

const [nm, cxxfilt, format, inputList, out, ...hintFiles] = process.argv.slice(2) as [
  string,
  string,
  ObjectFormat,
  string,
  string,
  ...string[],
];
const lists = hintFiles.map(path => readHintList(path, format));
const { names, listed, exact, normalized } = resolveHints(
  lists.flatMap(list => hintNames(list, format)),
  await functionNames(nm, readFileSync(inputList, "utf8").split("\n").filter(Boolean)),
  mangled => demangleRust(mangled, [cxxfilt]),
  lists.some(list => list.format !== format),
);
writeFileSync(out, names.join("\n") + "\n");
console.log(
  `symbol order: ${exact + normalized} of ${listed} hints resolved (${exact} exactly, ${normalized} by normalised name)`,
);
