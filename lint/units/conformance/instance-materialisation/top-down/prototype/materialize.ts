// Prototype: the virtual disk of an instance written below a directory that the caller gives, and the way back from real names.
import { cpSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { getNormalizedAbsolutePath, getRootLength, normalizeSlashes } from "../../../enumerator/prototype/tspath";
import type { CompilerTest } from "./compiler_test";

export type Reason =
  | "dos-root"
  | "other-root"
  | "case-collision"
  | "case-insensitive-requested"
  | "windows-name"
  | "path-too-long"
  | "link-not-permitted"
  | "absolute-path-in-text"
  | "lib-directory-missing"
  | "ancestor-has-project-files";

export interface Obstacle {
  reason: Reason;
  detail: string;
}

export interface Platform {
  // process.platform of the machine that holds the directory
  os: NodeJS.Platform;
  // whether the file system below the directory tells a.ts from A.ts
  caseSensitive: boolean;
}

const windowsBadCharacter = /[<>:"|?*\x00-\x1f]/;
const windowsReserved = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\..*)?$/i;
const referenceDirective = /<reference\s+(?:path|types|lib)\s*=\s*["']([^"']+)["']/g;
const rootedSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bmodule\s+)(["'])((?:\/|[a-zA-Z]:[\\/]|\\)[^"']*)\1/g;
const rootedJsonString = /"((?:\/|[a-zA-Z]:[\\/])[^"\n]*)"/g;

// The obstacles that the names and the texts of an instance show before anything is written.
export function findObstacles(test: CompilerTest, platform: Platform, rootLength: number, readsAbsolutePaths: boolean): Obstacle[] {
  const out: Obstacle[] = [];
  const files = [...test.toBeCompiled, ...test.otherFiles];
  // the program file names hold the names that @libFiles adds
  const paths = [...new Set([...files.map(f => f.unitName), ...test.symlinks.keys(), ...test.symlinks.values(), ...test.programFileNames, test.currentDirectory])];
  const lower = new Map<string, string>();
  for (const p of paths) {
    const root = p.slice(0, getRootLength(p));
    if (root !== "/") {
      out.push({ reason: /^[a-zA-Z]:/.test(root) ? "dos-root" : "other-root", detail: p });
      continue;
    }
    const segments = p.slice(1).split("/");
    if (platform.os === "win32") {
      for (const s of segments) {
        if (windowsBadCharacter.test(s) || windowsReserved.test(s) || /[. ]$/.test(s)) out.push({ reason: "windows-name", detail: p });
      }
      if (rootLength + p.length > 259) out.push({ reason: "path-too-long", detail: p });
    }
    if (!platform.caseSensitive) {
      for (let i = 1; i <= segments.length; i++) {
        const prefix = "/" + segments.slice(0, i).join("/");
        const other = lower.get(prefix.toLowerCase());
        if (other !== undefined && other !== prefix) out.push({ reason: "case-collision", detail: other + " and " + prefix });
        else lower.set(prefix.toLowerCase(), prefix);
      }
    }
  }
  if (!test.useCaseSensitiveFileNames && platform.caseSensitive) out.push({ reason: "case-insensitive-requested", detail: "" });
  if (readsAbsolutePaths) {
    for (const f of files) {
      if (/\.json$/i.test(f.unitName)) {
        for (const m of f.content.matchAll(rootedJsonString)) out.push({ reason: "absolute-path-in-text", detail: f.unitName + ": " + m[1] });
        continue;
      }
      for (const m of f.content.matchAll(referenceDirective)) {
        if (getRootLength(normalizeSlashes(m[1])) > 0) out.push({ reason: "absolute-path-in-text", detail: f.unitName + ": " + m[1] });
      }
      for (const m of f.content.matchAll(rootedSpecifier)) out.push({ reason: "absolute-path-in-text", detail: f.unitName + ": " + m[2] });
    }
  }
  return out;
}

export interface Materialized {
  root: string;
  cwd: string;
  // the program files as the process gets them, relative to cwd
  operands: string[];
  toReal(virtualName: string): string;
  toVirtual(printedName: string): string;
  mapText(text: string): string;
}

export type MaterializeResult = { ok: true; value: Materialized } | { ok: false; status: "not-materialisable"; obstacles: Obstacle[] };

export interface MaterializeOptions {
  // an existing empty directory; it stands for "/" of the virtual disk
  root: string;
  platform: Platform;
  // the copy of tests/lib, needed when the instance mounts /.lib
  libDirectory?: string;
  // true for a checker that opens absolute names of the texts on the real disk
  readsAbsolutePaths: boolean;
}

const sep = (os: NodeJS.Platform) => (os === "win32" ? "\\" : "/");

export function materialize(test: CompilerTest, options: MaterializeOptions): MaterializeResult {
  const { root, platform } = options;
  const obstacles = findObstacles(test, platform, root.length, options.readsAbsolutePaths);
  if (test.includeLibDir && options.libDirectory === undefined) obstacles.push({ reason: "lib-directory-missing", detail: "" });
  if (obstacles.length > 0) return { ok: false, status: "not-materialisable", obstacles };
  const s = sep(platform.os);
  const toReal = (virtualName: string) => root + (s === "/" ? virtualName : virtualName.replaceAll("/", s));
  const made = new Set<string>();
  const mkdirFor = (virtualName: string) => {
    const dir = virtualName.slice(0, virtualName.lastIndexOf("/"));
    if (dir === "" || made.has(dir)) return;
    mkdirSync(toReal(dir), { recursive: true });
    made.add(dir);
  };
  // harnessutil.go:195-216: the roots, the other files, the links, then the lib directory; a later entry replaces an earlier one
  const disk = new Map<string, Buffer>();
  for (const f of [...test.toBeCompiled, ...test.otherFiles]) disk.set(f.unitName, Buffer.from(f.content, "utf8"));
  for (const link of test.symlinks.keys()) disk.delete(link);
  for (const [name, bytes] of disk) {
    mkdirFor(name);
    writeFileSync(toReal(name), bytes);
  }
  for (const [link, target] of test.symlinks) {
    mkdirFor(link);
    const targetIsFile = disk.has(target);
    try {
      // a relative target would move with the link; the reference stores the absolute name
      symlinkSync(toReal(target), toReal(link), targetIsFile ? "file" : platform.os === "win32" ? "junction" : "dir");
    } catch (e) {
      return { ok: false, status: "not-materialisable", obstacles: [{ reason: "link-not-permitted", detail: link + ": " + (e as Error).message }] };
    }
  }
  if (test.includeLibDir && options.libDirectory !== undefined) {
    mkdirSync(toReal("/.lib"), { recursive: true });
    cpSync(options.libDirectory, toReal("/.lib"), { recursive: true, force: true });
  }
  const cwdVirtual = test.currentDirectory;
  const cwd = cwdVirtual === "/" ? root : toReal(cwdVirtual);
  mkdirSync(cwd, { recursive: true });
  const roots = [root];
  try {
    const real = realpathSync.native(root);
    if (real !== root) roots.push(real);
  } catch {}
  const folded = platform.os === "win32" || !platform.caseSensitive;
  // real names in any text become virtual names; the caller then applies removeTestPathPrefixes
  const mapText = (text: string): string => {
    for (const r of roots) {
      for (const variant of new Set([r, r.replaceAll("\\", "/")])) {
        let from = 0;
        for (;;) {
          const hay = folded ? text.toLowerCase() : text;
          const needle = folded ? variant.toLowerCase() : variant;
          const at = hay.indexOf(needle, from);
          if (at < 0) break;
          let end = at + variant.length;
          // the rest of the name, up to a character that ends a name in a message
          let rest = "";
          while (end < text.length && !/['"()\r\n]/.test(text[end]) && !(text[end] === ":" && /[0-9 ]/.test(text[end + 1] ?? " "))) {
            rest += text[end] === "\\" ? "/" : text[end];
            end++;
          }
          const replacement = rest === "" ? "/" : rest.startsWith("/") ? rest : undefined;
          if (replacement === undefined) {
            from = at + 1;
            continue;
          }
          text = text.slice(0, at) + replacement + text.slice(end);
          from = at + replacement.length;
        }
      }
    }
    return text;
  };
  const toVirtual = (printedName: string): string => {
    const n = normalizeSlashes(printedName);
    if (getRootLength(n) > 0) {
      const mapped = mapText(printedName);
      return mapped;
    }
    return getNormalizedAbsolutePath(n, cwdVirtual);
  };
  const operands = test.programFileNames.map(p => relativeTo(cwdVirtual, p, s));
  return { ok: true, value: { root, cwd, operands, toReal, toVirtual, mapText } };
}

// both names are virtual, absolute and normalized
function relativeTo(fromDir: string, to: string, s: string): string {
  const a = fromDir === "/" ? [] : fromDir.slice(1).split("/");
  const b = to.slice(1).split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const parts = [...a.slice(i).map(() => ".."), ...b.slice(i)];
  return parts.join(s);
}

export function emptyDirectory(dir: string) {
  for (const e of readdirSync(dir)) rmSync(dir + "/" + e, { recursive: true, force: true });
}

export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
