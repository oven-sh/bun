import { isAscii } from "buffer";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

export function cap(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}

export function low(str: string) {
  if (str.startsWith("JS")) {
    return "js" + str.slice(2);
  }

  return str[0].toLowerCase() + str.slice(1);
}

/** Every file under `root`, sorted by name in each directory. */
export function readdirRecursive(root: string): string[] {
  // The order of readdirSync() depends on the runtime and the file system:
  // node sorts the entries, and bun does not.
  const files = fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files.flatMap(file => {
    const fullPath = path.join(root, file.name);
    return file.isDirectory() ? readdirRecursive(fullPath) : fullPath;
  });
}

export function resolveSyncOrNull(specifier: string, from: string) {
  try {
    return Bun.resolveSync(specifier, from);
  } catch {
    return null;
  }
}

export function checkAscii(str: string) {
  if (!isAscii(Buffer.from(str))) {
    throw new Error(`non-ascii character in string "${str}". this will not be a valid ASCIILiteral`);
  }

  return str;
}

/** The first four bytes of the SHA-256 digest of the sources, read as a big-endian u32. */
export function sourceStamp(sources: Iterable<string>): number {
  const hash = createHash("sha256");
  for (const source of sources) hash.update(source);
  return hash.digest().readUInt32BE(0);
}

export function writeIfNotChanged(file: string, contents: string) {
  if (Array.isArray(contents)) contents = contents.join("");
  contents = contents.replaceAll("\r\n", "\n").trim() + "\n";

  try {
    const oldContents = fs.readFileSync(file, "utf8");
    if (oldContents === contents) {
      return;
    }
  } catch (e) {}

  try {
    fs.writeFileSync(file, contents);
  } catch (error) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  if (fs.readFileSync(file, "utf8") !== contents) {
    throw new Error(`Failed to write file ${file}`);
  }
}

export function writeIfNotChangedBinary(file: string, contents: Buffer) {
  try {
    if (fs.readFileSync(file).equals(contents)) return;
  } catch {}
  try {
    fs.writeFileSync(file, contents);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
}

export function readdirRecursiveWithExclusionsAndExtensionsSync(
  dir: string,
  exclusions: string[],
  exts: string[],
): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    if (exclusions.includes(entry.name)) return [];
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory()
      ? readdirRecursiveWithExclusionsAndExtensionsSync(fullPath, exclusions, exts)
      : exts.some(ext => fullPath.endsWith(ext))
        ? fullPath
        : [];
  });
}

export function pathToUpperSnakeCase(filepath: string) {
  return filepath
    .replace(/^.*?:/, "")
    .split(/[-_./\\]/g)
    .join("_")
    .toUpperCase();
}

export function argParse(keys: string[]): any {
  const options: { [key: string]: boolean | string } = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) {
      console.error("error: unknown argument: " + arg);
      process.exit(1);
    }
    const splitPos = arg.indexOf("=");
    let name = arg;
    let value: boolean | string = true;
    if (splitPos !== -1) {
      name = arg.slice(0, splitPos);
      value = arg.slice(splitPos + 1);
    }
    options[name.slice(2)] = value;
  }

  const unknown = new Set(Object.keys(options));
  for (const key of keys) {
    unknown.delete(key);
  }
  for (const key of unknown) {
    console.error("error: unknown argument: --" + key);
  }
  if (unknown.size > 0) process.exit(1);
  return options;
}
