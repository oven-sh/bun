/**
 * Makes the ICU data that Bun links: the package of the release without what nothing reads, most items replaced by
 * a zstd frame that `bun_icu_maybe_decompress` inflates when ICU first asks for the item.
 *
 *   data.ts <package of the release> <compress executable> <package to write> <dictionary to write>
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BuildError, assert } from "../error.ts";
import { checkSpelloutLocales, isShipped, staysUncompressed } from "./items.ts";
import { readPackage, writePackage } from "./package.ts";

/** The list format of compress.c. */
function writeList(entries: Buffer[]): Buffer {
  const sizes = Buffer.alloc(4 + 4 * entries.length);
  entries.reduce((at, entry) => sizes.writeUInt32LE(entry.length, at), sizes.writeUInt32LE(entries.length, 0));
  return Buffer.concat([sizes, ...entries]);
}

function readList(list: Buffer): Buffer[] {
  const count = list.readUInt32LE(0);
  let end = 4 + 4 * count;
  return Array.from({ length: count }, (_, index) => list.subarray(end, (end += list.readUInt32LE(4 + 4 * index))));
}

function compress(executable: string, entries: Buffer[], scratch: string): { frames: Buffer[]; dictionary: Buffer } {
  const files = [`${scratch}.items`, `${scratch}.frames`, `${scratch}.dictionary`] as const;
  try {
    writeFileSync(files[0], writeList(entries));
    const { error, status, signal } = spawnSync(executable, files, { stdio: "inherit" });
    if (error) throw new BuildError(`failed to run ${executable}`, { cause: error });
    assert(status === 0, `${executable} exited with ${status ?? signal}`);
    return { frames: readList(readFileSync(files[1])), dictionary: readFileSync(files[2]) };
  } finally {
    for (const file of files) rmSync(file, { force: true });
  }
}

/** The step is restat: the same bytes do not relink Bun. */
function writeBytesIfChanged(path: string, bytes: Buffer): void {
  if (!existsSync(path) || !readFileSync(path).equals(bytes)) writeFileSync(path, bytes);
}

function main(): void {
  const [input, executable, packagePath, dictionaryPath] = process.argv.slice(2);
  assert(
    input && executable && packagePath && dictionaryPath,
    "usage: data.ts <input> <compress> <package> <dictionary>",
  );

  const file = readFileSync(input);
  const release = readPackage(file);
  assert(writePackage(release).equals(file), "package.ts does not write back the ICU data package that it read", {
    file: input,
  });
  checkSpelloutLocales(release.items);

  const items = release.items.filter(item => isShipped(item.name));
  const candidates = items.filter(item => !staysUncompressed(item.name));
  const { frames, dictionary } = compress(
    executable,
    candidates.map(item => item.data),
    packagePath,
  );
  candidates.forEach((item, index) => {
    if (frames[index]!.length < item.data.length) item.data = frames[index]!;
  });

  const shipped = writePackage({ ...release, items });
  writeBytesIfChanged(packagePath, shipped);
  writeBytesIfChanged(dictionaryPath, dictionary);
  console.log(`${items.length} of ${release.items.length} items, ${shipped.length} + ${dictionary.length} bytes`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof BuildError)) throw error;
  process.stderr.write(error.format());
  process.exit(1);
}
