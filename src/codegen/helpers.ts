import { isAscii } from "node:buffer";
import fs from "node:fs";
import path from "node:path";

const EOL = "\n";
const EOL_CHAR_CODE = EOL.charCodeAt(0);
const scriptExtRegExp = /\.[mc]?[tj]s$/;

export const matchAllNonIdentCharsRegExp = /[^\$\w]+/g;

export const alphanumComparator = new Intl.Collator("en", { numeric: true }).compare;

export function cap(str: string) {
  return str[0].toUpperCase() + str.slice(1);
}

export function checkAscii(str: string) {
  if (!isAscii(Buffer.from(str))) {
    throw new Error(`non-ascii character in string "${str}". this will not be a valid ASCIILiteral`);
  }

  return str;
}

export function declareASCIILiteral(name: string, value: string) {
  const { 0: chars, 1: count } = fmtCPPString(value);
  return `static constexpr const char ${name}Bytes[${count}] = ${chars};
static constexpr ASCIILiteral ${name} = ASCIILiteral::fromLiteralUnsafe(${name}Bytes);`;
}

// MSVC has a max of 16k characters per string literal
// Combining string literals didn't support constexpr apparently
// so we have to do this the gigantic array way
export function fmtCPPString(str: string, nullTerminated: boolean = true) {
  const { length } = str;
  let chars = "{";
  for (let i = 0; i < length; i += 1) {
    chars += `${str.charCodeAt(i)},`;
  }
  chars += `${EOL_CHAR_CODE}${nullTerminated ? ",0" : ""}}`;
  return [chars, length + 1 + (nullTerminated ? 1 : 0)];
}

export function hasJsExt(str: string) {
  return str.endsWith(".js");
}

export function hasTsExt(str: string) {
  return str.endsWith(".ts") && !str.endsWith(".d.ts");
}

const upperCaseIds = new Set(["jsc", "ffi", "vm", "tls", "os", "ws", "fs", "dns"]);

export function idToEnumName(id: string) {
  const trimmed = trimScriptExt(id);
  // We don't match \w because we want to remove _ too.
  const parts = trimmed.match(/[a-zA-Z0-9]+/g);
  if (!parts) {
    throw new Error(`Invalid id ${id}`);
  }
  let enumName = "";
  for (let i = 0, { length } = parts; i < length; i += 1) {
    enumName += upperCaseIds.has(parts[i]) ? parts[i].toUpperCase() : cap(parts[i]);
  }
  return enumName;
}

export function idToPublicSpecifierOrEnumName(id: string) {
  id = trimScriptExt(id);
  if (id.startsWith("node/")) {
    return "node:" + id.slice(5).replaceAll(".", "/");
  } else if (id.startsWith("bun/")) {
    return "bun:" + id.slice(4).replaceAll(".", "/");
  } else if (id.startsWith("internal/")) {
    return "internal:" + id.slice(9).replaceAll(".", "/");
  } else if (id.startsWith("thirdparty/")) {
    return id.slice(11).replaceAll(".", "/");
  }
  return idToEnumName(id);
}

export function low(str: string) {
  return str.startsWith("JS") ? `js${str.slice(2)}` : `${str[0].toLowerCase()}${str.slice(1)}`;
}

export function pathToUpperSnakeCase(filepath: string) {
  return filepath
    .replace(/^[^:]+:/, "")
    .split(/[-_./\\]/g)
    .join("_")
    .toUpperCase();
}

export function readdirRecursive(root: string): string[] {
  const files = fs.readdirSync(root, { withFileTypes: true });
  return files.flatMap(file => {
    const fullPath = path.join(root, file.name);
    return file.isDirectory() ? readdirRecursive(fullPath) : fullPath;
  });
}

export function replaceScriptExtWithDotJS(str: string) {
  return str.replace(scriptExtRegExp, ".js");
}

export function resolveSyncOrNull(specifier: string, from: string) {
  try {
    return Bun.resolveSync(specifier, from);
  } catch {
    return null;
  }
}

export function trimScriptExt(str: string) {
  return str.replace(scriptExtRegExp, "");
}

export function writeIfChanged(file: string, content: string | string[]) {
  const contentAsString = Array.isArray(content) ? content.join("") : content;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === contentAsString) {
    return;
  }

  try {
    fs.writeFileSync(file, contentAsString);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contentAsString);
  }
}

export const writeIfNotChanged = writeIfChanged;
