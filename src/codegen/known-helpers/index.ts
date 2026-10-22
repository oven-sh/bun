import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { FoundFunction } from "./definitions.ts";
import { fetchPackages, versionsFileName, type FetchedVersion } from "./fetch.ts";
import { writeFixtures } from "./fixtures.ts";
import { folderNameOf, isChosen, toolOf } from "./packages.ts";
import { readers, sourcesOfEveryReader, type Reader } from "./read-version.ts";
import { writeShapes, writeUnnamedShapes } from "./report.ts";
import { writeRust } from "./rust.ts";
import { namedShapes } from "./shapes.ts";
import { loadParser } from "./syntax.ts";
import { buildTable, toolOfLine, type VersionRead } from "./table.ts";

const usage = `usage: bun src/codegen/known-helpers/index.ts <command>
  --fetch <folder>                        install the package versions of packages.ts from the npm registry into <folder>
  --packages <folder>                     read the helpers out of <folder>, then write any of:
      --out <file>                        the table (src/aot/known_helpers/published.rs)
      --report <folder>                   shapes.md and unnamed-shapes.md
      --fixtures <folder>                 what the tools emit for fixture-programs/ (test/aot/programs/known-helpers)
  --only <package or tool>..              fetch or read these alone; what is read so is good for --report, not for --out or --fixtures`;

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    "fetch": { type: "string" },
    "only": { type: "string", multiple: true, default: [] },
    "packages": { type: "string" },
    "out": { type: "string" },
    "report": { type: "string" },
    "fixtures": { type: "string" },
  },
});

const hashes = new Map<Reader, string>();

function hashOfSources(reader: Reader): string {
  let hash = hashes.get(reader);
  if (hash !== undefined) return hash;
  const hasher = new Bun.CryptoHasher("sha256");
  const add = (full: string) => {
    if (!statSync(full).isDirectory()) hasher.update(path.basename(full)).update(readFileSync(full));
    else for (const name of readdirSync(full).sort()) add(path.join(full, name));
  };
  for (const source of [...sourcesOfEveryReader, ...reader.sources]) add(path.join(import.meta.dir, source));
  hash = hasher.digest("hex").slice(0, 16);
  hashes.set(reader, hash);
  return hash;
}

async function readVersion(packages: string, version: FetchedVersion): Promise<VersionRead | undefined> {
  const sources = hashOfSources(readers[version.name]);
  const kept = path.join(packages, "read", `${folderNameOf(version.name, version.version)}.${sources}.json`);
  if (existsSync(kept)) return { version, found: await Bun.file(kept).json() };
  const worker = Bun.spawn([process.execPath, path.join(import.meta.dir, "read-version.ts"), packages, version.name, version.version], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(worker.stdout).text();
  if ((await worker.exited) !== 0) return undefined;
  await Bun.write(kept, output);
  return { version, found: JSON.parse(output) as FoundFunction[] };
}

async function readVersions(packages: string, versions: readonly FetchedVersion[]): Promise<(VersionRead | undefined)[]> {
  const read = new Array<VersionRead | undefined>(versions.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(versions.length, availableParallelism()) }, async () => {
    while (next < versions.length) {
      const index = next++;
      read[index] = await readVersion(packages, versions[index]);
    }
  });
  await Promise.all(workers);
  return read;
}

const isPartial = values.only.length > 0;

if (values.fetch !== undefined) {
  await fetchPackages(values.fetch, values.only);
} else if (values.packages === undefined || (values.out ?? values.report ?? values.fixtures) === undefined) {
  console.error(usage);
  process.exitCode = 2;
} else if (isPartial && (values.out ?? values.fixtures) !== undefined) {
  console.error("--only leaves packages unread: the table and the fixtures need all of them");
  process.exitCode = 2;
} else {
  const fetched: FetchedVersion[] = await Bun.file(path.join(values.packages, versionsFileName)).json();
  const wanted = fetched.filter(version => version.name in readers && isChosen(version.name, values.only));
  const results = await readVersions(values.packages, wanted);
  const read = results.filter(result => result !== undefined);
  const unread = wanted.filter((_, index) => results[index] === undefined);
  const toolsRead = new Set(read.map(one => toolOf(one.version.name)));
  const table = buildTable(read, isPartial ? namedShapes.filter(line => toolsRead.has(toolOfLine(line))) : namedShapes);
  if (values.out !== undefined) await Bun.write(values.out, writeRust(table));
  if (values.report !== undefined) {
    await mkdir(values.report, { recursive: true });
    await Bun.write(path.join(values.report, "shapes.md"), writeShapes(table));
    await Bun.write(path.join(values.report, "unnamed-shapes.md"), writeUnnamedShapes(table));
  }
  if (values.fixtures !== undefined) {
    await loadParser(values.packages);
    for (const line of await writeFixtures(values.packages, fetched, table, values.fixtures)) console.log(line);
  }
  const functionCount = read.reduce((sum, one) => sum + one.found.length, 0);
  console.log(`${read.length} versions, ${functionCount} functions, ${table.entries.length} trees named, ${table.unnamed.length} unnamed`);
  const complaints = [...unread.map(version => `${version.name}@${version.version} could not be read`), ...table.complaints];
  for (const complaint of complaints) console.error(complaint);
  process.exit(complaints.length > 0 ? 1 : 0);
}
