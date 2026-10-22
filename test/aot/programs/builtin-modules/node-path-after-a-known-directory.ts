// Paths that continue a directory that was asked about just before, against Node's lib/path.js, which stands below.
import { posix } from "node:path";

function validateString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError("ERR_INVALID_ARG_TYPE " + name);
}
function isPosixPathSeparator(code: number): boolean {
  return code === 47;
}
function normalizeString(path: string, allowAboveRoot: boolean, separator: string, isPathSeparator: (code: number) => boolean): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (isPathSeparator(code)) break;
    else code = 47;
    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += `${separator}${path.slice(lastSlash + 1, i)}`;
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}
function reference(cwd: () => string): Record<string, (...args: any[]) => unknown> {
  const posix = {
    resolve(...args: unknown[]): string {
      let resolvedPath = "";
      let resolvedAbsolute = false;
      for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
        const path = args[i];
        validateString(path, `paths[${i}]`);
        if (path.length === 0) continue;
        resolvedPath = `${path}/${resolvedPath}`;
        resolvedAbsolute = path.charCodeAt(0) === 47;
      }
      if (!resolvedAbsolute) {
        const directory = cwd();
        resolvedPath = `${directory}/${resolvedPath}`;
        resolvedAbsolute = directory.charCodeAt(0) === 47;
      }
      resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
      if (resolvedAbsolute) return `/${resolvedPath}`;
      return resolvedPath.length > 0 ? resolvedPath : ".";
    },
    normalize(path: unknown): string {
      validateString(path, "path");
      if (path.length === 0) return ".";
      const isAbsolute = path.charCodeAt(0) === 47;
      const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
      let normalized = normalizeString(path, !isAbsolute, "/", isPosixPathSeparator);
      if (normalized.length === 0) {
        if (isAbsolute) return "/";
        return trailingSeparator ? "./" : ".";
      }
      if (trailingSeparator) normalized += "/";
      return isAbsolute ? `/${normalized}` : normalized;
    },
    isAbsolute(path: unknown): boolean {
      validateString(path, "path");
      return path.length > 0 && path.charCodeAt(0) === 47;
    },
    join(...args: unknown[]): string {
      if (args.length === 0) return ".";
      const path: string[] = [];
      for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        validateString(arg, "path");
        if (arg.length > 0) path.push(arg);
      }
      if (path.length === 0) return ".";
      return posix.normalize(path.join("/"));
    },
    relative(from: unknown, to: unknown): string {
      validateString(from, "from");
      validateString(to, "to");
      if (from === to) return "";
      const resolvedFrom = posix.resolve(from);
      const resolvedTo = posix.resolve(to);
      if (resolvedFrom === resolvedTo) return "";
      const fromStart = 1;
      const fromEnd = resolvedFrom.length;
      const fromLen = fromEnd - fromStart;
      const toStart = 1;
      const toLen = resolvedTo.length - toStart;
      const length = fromLen < toLen ? fromLen : toLen;
      let lastCommonSep = -1;
      let i = 0;
      for (; i < length; i++) {
        const fromCode = resolvedFrom.charCodeAt(fromStart + i);
        if (fromCode !== resolvedTo.charCodeAt(toStart + i)) break;
        else if (fromCode === 47) lastCommonSep = i;
      }
      if (i === length) {
        if (toLen > length) {
          if (resolvedTo.charCodeAt(toStart + i) === 47) return resolvedTo.slice(toStart + i + 1);
          if (i === 0) return resolvedTo.slice(toStart + i);
        } else if (fromLen > length) {
          if (resolvedFrom.charCodeAt(fromStart + i) === 47) lastCommonSep = i;
          else if (i === 0) lastCommonSep = 0;
        }
      }
      let out = "";
      for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        if (i === fromEnd || resolvedFrom.charCodeAt(i) === 47) out += out.length === 0 ? ".." : "/..";
      }
      return `${out}${resolvedTo.slice(toStart + lastCommonSep)}`;
    },
    dirname(path: unknown): string {
      validateString(path, "path");
      if (path.length === 0) return ".";
      const hasRoot = path.charCodeAt(0) === 47;
      let end = -1;
      let matchedSlash = true;
      for (let i = path.length - 1; i >= 1; --i) {
        if (path.charCodeAt(i) === 47) {
          if (!matchedSlash) {
            end = i;
            break;
          }
        } else {
          matchedSlash = false;
        }
      }
      if (end === -1) return hasRoot ? "/" : ".";
      if (hasRoot && end === 1) return "//";
      return path.slice(0, end);
    },
    basename(path: unknown, given?: unknown): string {
      if (given !== undefined) validateString(given, "suffix");
      validateString(path, "path");
      const suffix = typeof given === "string" ? given : undefined;
      let start = 0;
      let end = -1;
      let matchedSlash = true;
      if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
        if (suffix === path) return "";
        let extIdx = suffix.length - 1;
        let firstNonSlashEnd = -1;
        for (let i = path.length - 1; i >= 0; --i) {
          const code = path.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else {
            if (firstNonSlashEnd === -1) {
              matchedSlash = false;
              firstNonSlashEnd = i + 1;
            }
            if (extIdx >= 0) {
              if (code === suffix.charCodeAt(extIdx)) {
                if (--extIdx === -1) end = i;
              } else {
                extIdx = -1;
                end = firstNonSlashEnd;
              }
            }
          }
        }
        if (start === end) end = firstNonSlashEnd;
        else if (end === -1) end = path.length;
        return path.slice(start, end);
      }
      for (let i = path.length - 1; i >= 0; --i) {
        if (path.charCodeAt(i) === 47) {
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else if (end === -1) {
          matchedSlash = false;
          end = i + 1;
        }
      }
      if (end === -1) return "";
      return path.slice(start, end);
    },
    extname(path: unknown): string {
      validateString(path, "path");
      let startDot = -1;
      let startPart = 0;
      let end = -1;
      let matchedSlash = true;
      let preDotState = 0;
      for (let i = path.length - 1; i >= 0; --i) {
        const char = path[i];
        if (char === "/") {
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
        if (end === -1) {
          matchedSlash = false;
          end = i + 1;
        }
        if (char === ".") {
          if (startDot === -1) startDot = i;
          else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
          preDotState = -1;
        }
      }
      if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
      return path.slice(startDot, end);
    },
    parse(path: unknown): { root: string; dir: string; base: string; ext: string; name: string } {
      validateString(path, "path");
      const ret = { root: "", dir: "", base: "", ext: "", name: "" };
      if (path.length === 0) return ret;
      const isAbsolute = path.charCodeAt(0) === 47;
      let start;
      if (isAbsolute) {
        ret.root = "/";
        start = 1;
      } else {
        start = 0;
      }
      let startDot = -1;
      let startPart = 0;
      let end = -1;
      let matchedSlash = true;
      let i = path.length - 1;
      let preDotState = 0;
      for (; i >= start; --i) {
        const code = path.charCodeAt(i);
        if (code === 47) {
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
        if (end === -1) {
          matchedSlash = false;
          end = i + 1;
        }
        if (code === 46) {
          if (startDot === -1) startDot = i;
          else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
          preDotState = -1;
        }
      }
      if (end !== -1) {
        const begin = startPart === 0 && isAbsolute ? 1 : startPart;
        if (startDot === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
          ret.base = ret.name = path.slice(begin, end);
        } else {
          ret.name = path.slice(begin, startDot);
          ret.base = path.slice(begin, end);
          ret.ext = path.slice(startDot, end);
        }
      }
      if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
      else if (isAbsolute) ret.dir = "/";
      return ret;
    },
  };
  return posix;
}

const workingDirectory = () => process.cwd().replaceAll("\\", "/");
const node = reference(process.platform === "win32" ? () => workingDirectory().slice(workingDirectory().indexOf("/")) : () => process.cwd());
let cases = 0;
let differences = 0;
function outcome(f: Function, args: unknown[]): string {
  const result = f(...args);
  return typeof result === "object" ? JSON.stringify(result) + Reflect.ownKeys(result).join() : JSON.stringify(result);
}
function same(name: string, args: string[]) {
  cases++;
  const expected = outcome(node[name]!, args);
  const actual = outcome((posix as any)[name], args);
  if (expected !== actual && differences++ < 10) console.log(`${name}(${JSON.stringify(args)}): ${actual}, Node: ${expected}`);
}
const alphabet = ["a", ".", "/"];
const all = (length: number): string[] => (length === 0 ? [""] : all(length - 1).flatMap(rest => alphabet.map(unit => unit + rest)));

const directories = ["/a", "/a/b", "/a.b/c", "/a/", "/a/b/", "a", "a/b", "a/", "/", "/.a", "/a..", "/...", "..a", "/a/.b", "/é/日本"];
const tails = [0, 1, 2, 3, 4, 5].flatMap(all);
for (const directory of directories) {
  for (const remember of [() => posix.join(directory, "x"), () => posix.resolve(directory, "x"), () => posix.relative(directory, "/x")]) {
    for (const tail of tails) {
      const longer = directory + tail;
      remember();
      same("normalize", [longer]);
      remember();
      same("resolve", [longer]);
      remember();
      same("join", [longer, "y"]);
      remember();
      same("join", ["y", longer]);
      remember();
      same("join", [directory, tail]);
      remember();
      same("join", [directory, tail, "y"]);
      remember();
      same("resolve", [directory, tail]);
      remember();
      same("resolve", [longer, "y"]);
      remember();
      same("relative", [directory, longer]);
      remember();
      same("relative", [longer, directory]);
      remember();
      same("relative", [longer, longer + "/y"]);
    }
  }
}
console.log(cases, "cases,", differences, "differ from Node");
