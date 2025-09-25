import { Glob } from "bun";

const rootFolders = {
  "bun": "src",
  "std": "vendor/zig/lib/std",
  "cpp": "build/debug/codegen",
};
const includeModules = new Set(["bun", "cpp"]);
const excludeGlobs = [new Glob("src/deps/**/*"), new Glob("src/bun.js/bindings/bun-simdutf.zig")];
const excludePaths = new Set(["src/deps/boringssl.translated.zig", "src/deps/libuv.zig"]);
const loadFiles = [
  "coverage/usage-x86_64-macos.txt",
  "coverage/usage-x86_64-windows.txt",
  "coverage/usage-x86_64-linux.txt",
  "coverage/usage-aarch64-macos.txt",
  "coverage/usage-aarch64-linux.txt",
];

const filterFileArgs = process.argv.slice(2);

async function addFile(filepath: string, result: Map<string, boolean>) {
  console.time(filepath);
  const usage = await Bun.file(filepath).text();
  for (let line of usage.split("\n")) {
    line = line.trim();
    if (line === "") continue;
    if (line.startsWith("#")) continue;

    const [, source, value] = line.match(/^(.+?:.+?:.+?): (.+?)$/);
    if (!result.has(source)) result.set(source, false);
    if (value === "DEFINED") continue; // done
    if (value !== "REFERENCED" && !value.startsWith("REFERENCED AT ")) throw new Error(`Unknown value: ${value}`);
    result.set(source, true);
  }
  console.timeEnd(filepath);
}

function baseFilterUnused(result: Map<string, boolean>): string[] {
  return Array.from(result.entries())
    .filter(([, value]) => !value)
    .map(([source]) => source);
}
function getFilteredUnused(allIn: string[]): string[] {
  const all = allIn.filter(source => {
    const { module } = getDeclInfo(source);
    return includeModules.has(module);
  });
  const allPaths = all.map(source => {
    const { module, path } = getDeclInfo(source);
    return `${rootFolders[module]}/${path}`;
  });
  const excludedPaths = new Set(allPaths.filter(path => excludeGlobs.some(glob => glob.match(path))));
  return all
    .filter(source => {
      const { module, path } = getDeclInfo(source);
      const fullPath = `${rootFolders[module]}/${path}`;
      if (filterFileArgs.length > 0) return filterFileArgs.some(arg => fullPath.includes(arg));
      return !excludedPaths.has(fullPath);
    })
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  let baseFiltered: string[] = [];
  try {
    // 1. check if we can use base filtered based on stat
    let latestLoadFileTime: number = 0;
    for (const file of loadFiles) {
      const stat = await Bun.file(file).stat();
      if (stat.mtime.getTime() > latestLoadFileTime) {
        latestLoadFileTime = stat.mtime.getTime();
      }
    }
    let baseFilteredFileTime = (await Bun.file("coverage/base-filtered.txt").stat()).mtime.getTime();
    if (baseFilteredFileTime < latestLoadFileTime) {
      throw new Error("Base filtered file is older than the latest load file");
    }

    const baseFilteredFile = await Bun.file("coverage/base-filtered.txt").text();
    baseFiltered = baseFilteredFile.split("\n");
  } catch (error) {
    const result = new Map<string, boolean>();
    for (const file of loadFiles) {
      await addFile(file, result);
    }
    baseFiltered = baseFilterUnused(result);
    await Bun.write("coverage/base-filtered.txt", baseFiltered.join("\n"));
  }
  const unused = getFilteredUnused(baseFiltered);

  for (const source of unused) {
    const { module, path, line, col } = getDeclInfo(source);
    if (!rootFolders[module]) continue;
    const fullPath = `${rootFolders[module]}/${path}`;
    await renderError(
      { file: fullPath, start: { line: +line, column: +col }, end: { line: +line, column: +col } },
      "unused declaration",
      "error",
      "\x1b[31m",
    );
  }
}

function getDeclInfo(decl: string) {
  const [module, filefull] = decl.split(" ");
  const [path, line, col] = filefull.split(":");
  return { module, path, line, col };
}

type Point = {
  line: number;
  column: number;
};
type Srcloc = {
  file: string;
  start: Point;
  end: Point;
};

const fileCache = new Map<string, string[]>();
async function readFileCached(file: string): Promise<string[]> {
  if (!fileCache.has(file)) {
    const fileContent = await Bun.file(file).text();
    fileCache.set(file, fileContent.split("\n"));
  }
  return fileCache.get(file)!;
}
async function renderError(position: Srcloc, message: string, label: string, color: string) {
  // for optimal cppbind errors, check for a /// Source: comment and then check the source-links file to determine which line to actually point to
  const lines = await readFileCached(position.file);
  const line = lines[position.start.line - 1];
  if (line === undefined) return;

  console.error(
    `\x1b[m${position.file}:${position.start.line}:${position.start.column}: ${color}\x1b[1m${label}:\x1b[m ${message}`,
  );
  const before = `${position.start.line} |   ${line.substring(0, position.start.column - 1)}`;
  const after = line.substring(position.start.column - 1);
  console.error(`\x1b[90m${before}${after}\x1b[m`);
  let length = position.start.line === position.end.line ? position.end.column - position.start.column : 1;
  console.error(`\x1b[m${" ".repeat(Bun.stringWidth(before))}${color}^${"~".repeat(Math.max(length - 1, 0))}\x1b[m`);
}

if (import.meta.main) {
  await main();
}
