import { existsSync, readFileSync } from "node:fs";
import { GeneratorError } from "./declarations.ts";
import { findStaleEntries, hashOfEntry, parseVerifiedList, type TableDump, type VerifiedListPaths } from "./dump.ts";
import { dumpOverload } from "./emit-dump.ts";
import type { TableModel } from "./model.ts";

const hashPattern = /^[0-9a-f]{16}$/;

export function applyTextHashes(model: TableModel): void {
  for (const overload of model.overloads) overload.textHash = hashOfEntry(dumpOverload(overload));
}

function readVerifiedList(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const hashes = parseVerifiedList(readFileSync(path, "utf8"));
  for (const hash of hashes) {
    if (!hashPattern.test(hash)) {
      throw new GeneratorError(`${path}: ${JSON.stringify(hash)} is not sixteen hexadecimal digits`);
    }
  }
  return hashes;
}

export function readVerifiedHashes(paths: VerifiedListPaths): Set<string> {
  return readVerifiedList(paths.engine).union(readVerifiedList(paths.host));
}

export function reportStaleEntries(dump: TableDump, verifiedHashes: ReadonlySet<string>): void {
  const staleTokens = findStaleEntries(dump, verifiedHashes);
  if (staleTokens.length > 0)
    console.error(`builtins table: ${staleTokens.length} hand-written overloads are untested`);
}
