import fs from "fs";
import path from "path";
import { isAscii } from "buffer";

// MSVC has a max of 16k characters per string literal
// Combining string literals didn't support constexpr apparently
// so we have to do this the gigantic array way
export function fmtCPPString(str: string, nullTerminated: boolean = true) {
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
  return [chars, normalized.length + (nullTerminated ? 1 : 0)];
}

export function declareASCIILiteral(name: string, value: string) {
  const [chars, count] = fmtCPPString(value);
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

  if (fs.existsSync(file)) {
    const oldContents = fs.readFileSync(file, "utf8");
    if (oldContents === contents) {
      return;
    }
  }

  try {
    fs.writeFileSync(file, contents);
  } catch (error) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
}
