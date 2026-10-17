// @ts-check
const isWindows = process.platform === "win32";

// Mirrors the pre-encode table in node's src/node_url.cc EncodePathChars();
// the URL parser then applies the WHATWG path percent-encode set to the rest.
const encodePathCharsRe = /[\0\t\n\r "#%?[\\\]^|~]/g;

function encodePosixPathChar(ch: string): string {
  switch (ch) {
    case "\0":
      return "%00";
    case "\t":
      return "%09";
    case "\n":
      return "%0A";
    case "\r":
      return "%0D";
    case " ":
      return "%20";
    case '"':
      return "%22";
    case "#":
      return "%23";
    case "%":
      return "%25";
    case "?":
      return "%3F";
    case "[":
      return "%5B";
    case "\\":
      return "%5C";
    case "]":
      return "%5D";
    case "^":
      return "%5E";
    case "|":
      return "%7C";
    default:
      return "%7E";
  }
}
function encodeWindowsPathChar(ch: string): string {
  return ch === "\\" ? "/" : encodePosixPathChar(ch);
}

// Equivalent of node's bindingUrl.pathToFileURL (src/node_url.cc).
function createFileURL(filepath: string, windows: boolean, hostname?: string): URL {
  let outURL: URL;
  try {
    outURL = new URL(
      "file://" + filepath.replace(encodePathCharsRe, windows ? encodeWindowsPathChar : encodePosixPathChar),
    );
  } catch {
    throw $ERR_INVALID_URL(filepath);
  }
  if (hostname !== undefined) {
    // The WHATWG hostname setter is silent on failure; node throws when ada's
    // set_hostname() fails. Probe with the parser, which does throw.
    try {
      new URL("file://" + hostname + "/");
    } catch {
      throw $ERR_INVALID_URL(filepath, hostname);
    }
    outURL.hostname = hostname;
  }
  return outURL;
}

function pathToFileURL(filepath: unknown, options?: any): URL {
  if (typeof filepath !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string", filepath);
  const path = require("node:path");
  const windows: boolean = !!(options?.windows ?? isWindows);
  const isUNC = windows && filepath.startsWith("\\\\");
  let resolved = isUNC ? filepath : windows ? path.win32.resolve(filepath) : path.posix.resolve(filepath);
  if (isUNC || (windows && resolved.startsWith("\\\\"))) {
    // UNC path format: \\server\share\resource
    // "\\?\UNC\" extended UNC path prefix is ignored.
    const isExtendedUNC = resolved.startsWith("\\\\?\\UNC\\");
    const prefixLength = isExtendedUNC ? 8 : 2;
    const hostnameEndIndex = resolved.indexOf("\\", prefixLength);
    if (hostnameEndIndex === -1) {
      throw $ERR_INVALID_ARG_VALUE("path", resolved, "Missing UNC resource path");
    }
    if (hostnameEndIndex === prefixLength) {
      throw $ERR_INVALID_ARG_VALUE("path", resolved, "Empty UNC servername");
    }
    const hostname = resolved.slice(prefixLength, hostnameEndIndex);
    return createFileURL(resolved.slice(hostnameEndIndex), true, hostname);
  }
  // path.resolve strips trailing slashes so we must add them back
  const filePathLast = filepath.charCodeAt(filepath.length - 1);
  if ((filePathLast === 47 || (windows && filePathLast === 92)) && resolved[resolved.length - 1] !== path.sep) {
    resolved += "/";
  }
  return createFileURL(resolved, windows);
}

export default pathToFileURL;
