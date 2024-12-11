import { isAscii } from "buffer";
import fs from "fs";
import path from "path";

// MSVC has a max of 16k characters per string literal
// Combining string literals didn't support constexpr apparently
// so we have to do this the gigantic array way
export function fmtCPPCharArray(str: string, nullTerminated: boolean = true) {
  const normalized = str + "\n";

  var remain = normalized;

  const chars =
    "{" +
    remain
      .split("")
      .map(a => a.charCodeAt(0))
      .join(",") +
    (nullTerminated ? ",0" : "") +
    "}";
  return [chars, normalized.length + (nullTerminated ? 1 : 0)] as const;
}

export function addCPPCharArray(str: string, nullTerminated: boolean = true) {
  const normalized = str.trim() + "\n";
  return (
    normalized
      .split("")
      .map(a => a.charCodeAt(0))
      .join(",") + (nullTerminated ? ",0" : "")
  );
}

export function declareASCIILiteral(name: string, value: string) {
  const [chars, count] = fmtCPPCharArray(value, true);
  return `static constexpr const char ${name}Bytes[${count}] = ${chars};
static constexpr ASCIILiteral ${name} = ASCIILiteral::fromLiteralUnsafe(${name}Bytes);`;
}

export function cap(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}

export function low(str: string) {
  if (str.startsWith("JS")) {
    return "js" + str.slice(2);
  }

  return str[0].toLowerCase() + str.slice(1);
}

export function readdirRecursive(root: string): string[] {
  const files = fs.readdirSync(root, { withFileTypes: true });
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

export function camelCase(string: string) {
  return string
    .split(/[\s_]/)
    .map((e, i) => (i ? e.charAt(0).toUpperCase() + e.slice(1).toLowerCase() : e.toLowerCase()));
}

export function pascalCase(string: string) {
  return string.split(/[\s_]/).map((e, i) => (i ? e.charAt(0).toUpperCase() + e.slice(1) : e.toLowerCase()));
}

export function argParse(keys: string[]): any {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) {
      console.error("Unknown argument " + arg);
      process.exit(1);
    }
    const split = arg.split("=");
    const value = split[1] || "true";
    options[split[0].slice(2)] = value;
  }

  const unknown = new Set(Object.keys(options));
  for (const key of keys) {
    unknown.delete(key);
  }
  for (const key of unknown) {
    console.error("Unknown argument: --" + key);
  }
  if (unknown.size > 0) process.exit(1);
  return options;
}
