// `list.sort((a, b) => a.rank - b.rank)` on a short list: the comparator reads two fields, so nobody can see the list while it is sorted, and it is sorted where it lies.
// A comparator that can look at the list keeps the copy: it has to see the list as it was.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const fieldsOnly = `
const list = [{ rank: 3 }, { rank: process.argv.length }, { rank: 1 }];
list.sort((a, b) => a.rank - b.rank);
console.log(list.map(item => item.rank).join());
`;
const readsTheList = `
const list = [{ rank: 3 }, { rank: process.argv.length }, { rank: 1 }];
list.sort((a, b) => a.rank - b.rank + list[0].rank * 0);
console.log(list.map(item => item.rank).join());
`;

async function functionsOf(source: string): Promise<string[]> {
  using dir = tempDir("aot-sort-where-it-lies", { "entry.js": source });
  const folder = String(dir);
  const mapPath = join(folder, "entry.map");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", join(folder, "entry.js"), "--outfile", join(folder, "entry")],
      folder,
      { ...bunEnv, BUN_JSC_aotMapFilePath: mapPath },
    ),
  );
  return readFileSync(mapPath, "utf8")
    .split("\n")
    .filter(line => line.startsWith("F\t"))
    .map(line => line.split("\t")[7]);
}

test.skipIf(!!unsupported)(
  "only a comparator that cannot look at the list sorts it where it lies",
  async () => {
    await slot(async () => {
      expect(await functionsOf(fieldsOnly)).toContain("sortWhereNobodySeesTheComparator");
      expect(await functionsOf(readsTheList)).not.toContain("sortWhereNobodySeesTheComparator");
    });
  },
  120_000,
);
