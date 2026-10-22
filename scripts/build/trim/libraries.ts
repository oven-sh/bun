import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { librariesFilePath, objectPath } from "../compile.ts";
import type { Config } from "../config.ts";
import { allDeps } from "../deps/index.ts";
import { assert, BuildError } from "../error.ts";
import { writeIfChanged } from "../fs.ts";
import type { DepName, ResolvedDep, Source } from "../source.ts";
import type { SectionGraph } from "./graph.ts";
import type { Partition } from "./partition.ts";

export interface Library {
  name: string;
  version: string;
  inputs: string[];
  crates: string[];
  compiledInto?: string;
}

export interface LibrariesFile {
  nm: string;
  libraries: Library[];
}

export interface LibraryBytes {
  name: string;
  version: string;
  retainedBytes: number;
  sets: number[];
}

const libraryOf: Record<DepName, { name: string; crate?: string; compiledInto?: DepName } | undefined> = {
  WebKit: undefined,
  nodejs: undefined,
  boringssl: { name: "BoringSSL" },
  brotli: { name: "Brotli" },
  cares: { name: "c-ares" },
  hdrhistogram: { name: "HdrHistogram_c" },
  highway: { name: "Highway" },
  libarchive: { name: "libarchive" },
  libdeflate: { name: "libdeflate" },
  "libjpeg-turbo": { name: "libjpeg-turbo" },
  libspng: { name: "libspng" },
  libuv: { name: "libuv" },
  libwebp: { name: "libwebp" },
  lolhtml: { name: "lol-html", crate: "lol_html" },
  lshpack: { name: "ls-hpack" },
  lsqpack: { name: "ls-qpack", compiledInto: "lsquic" },
  lsquic: { name: "lsquic" },
  mimalloc: { name: "mimalloc" },
  picohttpparser: { name: "picohttpparser" },
  "rust-argon2": { name: "rust-argon2", crate: "argon2" },
  sqlite: { name: "SQLite" },
  tinycc: { name: "TinyCC" },
  zlib: { name: "zlib-ng" },
  zstd: { name: "zstd" },
};

function versionOfSource(dep: DepName, source: Source): string {
  switch (source.kind) {
    case "github-archive":
      return source.commit.slice(0, 8);
    case "prebuilt":
      return source.identity.slice(0, 8);
    case "local":
      return "local";
    case "in-tree":
      throw new BuildError(`${dep} is built from Bun's own tree, so its dependency needs a release`);
  }
}

function createLibrary(cfg: Config, dep: ResolvedDep): Library | undefined {
  const entry = libraryOf[dep.name];
  if (entry === undefined) return undefined;
  const definition = allDeps.find(candidate => candidate.name === dep.name);
  assert(definition !== undefined, `${dep.name} is not among the dependencies`);
  const inputs = [...dep.libs, ...dep.objects, ...dep.sources.map(src => objectPath(cfg, src))];
  const crates = entry.crate === undefined ? [] : [entry.crate];
  const compiledInto = entry.compiledInto === undefined ? undefined : libraryOf[entry.compiledInto]?.name;
  if (inputs.length === 0 && crates.length === 0 && compiledInto === undefined) {
    throw new BuildError(`the library ${entry.name} has no inputs, so a trimmed executable cannot tell whether it was removed`);
  }
  const version = definition.release ?? versionOfSource(dep.name, definition.source(cfg));
  return { name: entry.name, version, inputs, crates, ...(compiledInto === undefined ? {} : { compiledInto }) };
}

export function writeLibrariesFile(cfg: Config, deps: ResolvedDep[]): string {
  assert(cfg.nm !== undefined, "a trimmable link needs llvm-nm");
  const libraries = deps.flatMap(dep => createLibrary(cfg, dep) ?? []);
  libraries.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  const path = librariesFilePath(cfg);
  writeIfChanged(path, JSON.stringify({ nm: cfg.nm, libraries }, null, 2) + "\n");
  return path;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(element => typeof element === "string");
}

function isLibrary(value: unknown): value is Library {
  if (typeof value !== "object" || value === null) return false;
  const { name, version, inputs, crates, compiledInto } = value as Record<string, unknown>;
  const hasValidCompiledInto = compiledInto === undefined || typeof compiledInto === "string";
  return typeof name === "string" && typeof version === "string" && isStringArray(inputs) && isStringArray(crates) && hasValidCompiledInto;
}

export function readLibrariesFile(path: string): LibrariesFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new BuildError("cannot read the list of libraries", { file: path, cause });
  }
  const { nm, libraries } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof nm !== "string" || !Array.isArray(libraries) || !libraries.every(isLibrary)) {
    throw new BuildError("malformed list of libraries", { file: path });
  }
  return { nm, libraries };
}

function filesOfLibrary(library: Library, linkInputs: string[]): string[] {
  const isCrateArchive = (path: string) => {
    const file = basename(path);
    return file.endsWith(".rlib") && library.crates.some(crate => file.startsWith(`lib${crate}-`));
  };
  const files = [...library.inputs, ...linkInputs.filter(isCrateArchive)];
  if (files.length === 0) throw new BuildError(`no input of the link belongs to the library ${library.name}`);
  return files;
}

function readDefinedSymbols(nm: string, files: string[], responseFile: string): string[] {
  writeFileSync(responseFile, files.map(file => JSON.stringify(file)).join("\n") + "\n");
  const args = ["--defined-only", "--extern-only", "--format=just-symbols", "--no-sort", `@${responseFile}`];
  const result = spawnSync(nm, args, { encoding: "latin1", maxBuffer: 1 << 30 });
  if (result.error !== undefined || result.status !== 0) {
    throw new BuildError(`${nm} failed on ${responseFile}`, { hint: result.stderr, cause: result.error });
  }
  return result.stdout.split(/\r?\n/).filter(line => line !== "" && !line.endsWith(":"));
}

function ownersOfSymbols(symbols: string[][]): Map<string, number> {
  const owners = new Map<string, number>();
  const shared = new Set<string>();
  symbols.forEach((names, library) => {
    for (const name of names) {
      const owner = owners.get(name);
      if (owner === undefined) owners.set(name, library);
      else if (owner !== library) shared.add(name);
    }
  });
  for (const name of shared) owners.delete(name);
  return owners;
}

function namesOfNode(graph: SectionGraph, node: number): string[] {
  return [...graph.names[node]!, ...(graph.aliases.get(node) ?? []).map(([, name]) => name)];
}

function measureLibraries(count: number, owners: Map<string, number>, graph: SectionGraph, partition: Partition) {
  const measured = Array.from({ length: count }, () => ({ retainedBytes: 0, sets: new Set<number>() }));
  for (let node = 0; node < graph.placedCount; node++) {
    const libraries = new Set(namesOfNode(graph, node).flatMap(name => owners.get(name) ?? []));
    for (const library of libraries) {
      if (partition.isRetained[node] || partition.setOf[node] === 0) measured[library]!.retainedBytes += graph.size[node]!;
      else measured[library]!.sets.add(partition.setOf[node]!);
    }
  }
  return measured;
}

export function libraryBytes(file: LibrariesFile, linkInputs: string[], graph: SectionGraph, partition: Partition, workDirectory: string): LibraryBytes[] {
  mkdirSync(workDirectory, { recursive: true });
  const symbols = file.libraries.map((library, index) =>
    library.compiledInto === undefined ? readDefinedSymbols(file.nm, filesOfLibrary(library, linkInputs), join(workDirectory, `${index}.nm.rsp`)) : [],
  );
  const measured = measureLibraries(file.libraries.length, ownersOfSymbols(symbols), graph, partition);
  const indexOfName = new Map(file.libraries.flatMap((library, index) => (library.compiledInto === undefined ? [[library.name, index] as const] : [])));
  return file.libraries.map((library, index) => {
    const source = library.compiledInto === undefined ? index : indexOfName.get(library.compiledInto);
    if (source === undefined) throw new BuildError(`${library.name} is compiled into ${library.compiledInto}, which is not a library`);
    const { retainedBytes, sets } = measured[source]!;
    return { name: library.name, version: library.version, retainedBytes, sets: [...sets].sort((a, b) => a - b) };
  });
}
