// path.posix against Node's lib/path.js, which stands below, on strings of every kind. A compiled program calls the same native node:path as plain Bun, so it prints what plain Bun prints,
// also where that differs from Node: the native code goes through UTF-8, so a lone surrogate comes back as U+FFFD and basename counts a suffix in bytes.
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
const pieces = ["a", "bc", "def", ".", "..", "", "/", "//", "./", "../", "a/b", "/a", "b/", "...", ".a", "a.", "..a", "a..", " ", "é", "日本", "\u{1F600}", "a/./b", "a/../b", "../..", "/..", "/.", "x.y.z", "node_modules", "\ud800", "\udc00x", "\\", "C:", "%2e", ".ts", "index.ts", "\u0000", "\ud7ff", "\uffff"];
const names = ["name", "project", "src", "index.ts", "node_modules", "x.y.z", ".git", "a", "lib.d.ts", "..x", "x..", "...", ".x."];
let seed = 12345;
const next = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8) % n;
function untidy(): string {
  let path = next(3) === 0 ? "/" : "";
  for (let k = next(7); k > 0; k--) {
    path += pieces[next(pieces.length)];
    if (next(3) !== 0) path += "/";
  }
  return path;
}
function tidy(): string {
  let path = "/" + ["Users", "home", "a", "tmp"][next(4)];
  for (let k = next(6); k > 0; k--) path += "/" + names[next(names.length)];
  return path;
}
function tail(): string {
  let path = names[next(names.length)]!;
  for (let k = next(4); k > 0; k--) path += "/" + names[next(names.length)];
  return path;
}
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
const ofOnePath = ["parse", "normalize", "isAbsolute", "dirname", "basename", "extname", "resolve", "join"];
const alphabet = ["a", ".", "/"];
const all = (length: number): string[] => (length === 0 ? [""] : all(length - 1).flatMap(rest => alphabet.map(unit => unit + rest)));

for (let round = 0; round < 5000; round++) {
  const isUntidy = round % 3 !== 0;
  const p = isUntidy ? untidy() : tidy();
  const q = isUntidy ? untidy() : tidy();
  for (const name of ofOnePath) same(name, [p]);
  same("basename", [p, q]);
  same("basename", [p, p.slice(next(p.length + 1))]);
  same("basename", [p, pieces[next(pieces.length)]!]);
  same("basename", [p + ".ts", ".ts"]);
  same("basename", [p, ""]);
  for (const name of ["resolve", "join"]) {
    same(name, [p, q]);
    same(name, [p, q, untidy()]);
    same(name, ["/" + p, q]);
    same(name, [tidy(), tail()]);
    same(name, [tidy(), tail() + "/"]);
    same(name, [tidy() + "/", tail()]);
    same(name, [tidy(), "/" + tail()]);
    same(name, [tidy(), "..", tail()]);
    same(name, [tidy(), "../" + tail()]);
    same(name, [tidy(), "./" + tail()]);
    same(name, [tidy(), tail(), tail(), tail()]);
    same(name, ["/", tail()]);
    same(name, [tail(), tail()]);
    same(name, ["", p]);
    same(name, [p, ""]);
    same(name, []);
  }
  const c = tidy();
  same("relative", [p, q]);
  same("relative", ["/" + p, "/" + q]);
  same("relative", [p, p]);
  same("relative", [tidy(), tidy()]);
  same("relative", [c, c + "/x/y"]);
  same("relative", [c + "/x/y", c]);
  same("relative", [c, c + "x"]);
  same("relative", [c + "x", c]);
  same("relative", [c, "/"]);
  same("relative", ["/", c]);
  same("relative", [c + "/", c]);
  same("relative", [c, c + "/"]);
  same("relative", [c + "/" + tail(), c + "/" + tail()]);
  same("relative", [c + "/.", c + "/.."]);
  same("relative", [c + "/.x", c + "/..y"]);
  same("relative", [c + "/a/b/c/d/e/f/g/h/i/j/k", c + "/" + tail()]);
}
for (let length = 0; length <= 7; length++) {
  for (const path of all(length)) {
    for (const name of ofOnePath) same(name, [path]);
    for (const suffix of [".", "a", "/", "..", "a.", ".a"]) same("basename", [path, suffix]);
  }
}
for (const first of all(4)) {
  for (const second of all(4)) {
    same("relative", ["/" + first, "/" + second]);
    same("resolve", ["/" + first, second]);
    same("join", [first, second]);
    same("join", ["/" + first, second]);
    same("basename", [first, second]);
  }
}
for (const first of all(3)) {
  for (const second of all(3)) {
    for (const third of all(2)) {
      same("join", [first, second, third]);
      same("resolve", ["/" + first, second, third]);
    }
  }
}
console.log(cases, "cases,", differences, "differ from Node");
console.log(JSON.stringify([posix.normalize("/a/../\ud800/b"), posix.join("/a", "\udc00"), posix.dirname("/\ud800/b"), posix.basename("/a/é.ts", ".ts"), posix.relative("/a/\ud800", "/a/\udc00")]));
for (const name of ["resolve", "normalize", "isAbsolute", "join", "relative", "dirname", "basename", "extname", "parse"]) console.log((posix as any)[name].name, (posix as any)[name].length);
