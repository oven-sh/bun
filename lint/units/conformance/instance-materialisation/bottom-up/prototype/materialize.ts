// Research prototype: the file system of an instance written below a directory that the caller gives, and the way back.
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import type { HarnessFs } from "./compiler_test";
import { MemFs, MemFsPanic, type MemInput } from "./memfs";
import { getRootLength } from "./tspath";

export type Unfaithful =
  | "drive-root"
  | "case-insensitive-instance"
  | "case-clash"
  | "windows-name"
  | "links-unavailable"
  | "path-too-long"
  | "unicode-normalisation"
  | "ancestor-pollution"
  | "invalid-file-system";

export interface Platform {
  // the disk below the directory tells names apart by case
  caseSensitive: boolean;
  // the disk keeps the bytes of a name as given
  preservesNames: boolean;
  // a link can be made below the directory
  links: boolean;
  windows: boolean;
  // longest real path that the platform takes, 0 when there is no limit worth a check
  maxPath: number;
}

export interface Materialised {
  root: string;
  // real path of the current directory of the instance, it exists
  currentDirectory: string;
  // real paths of the program file names, in order
  roots: string[];
  toReal(virtualName: string): string;
  toVirtual(realPath: string): string | undefined;
  // every occurrence of the real root in a text becomes the virtual name
  mapText(text: string): string;
}

export type MaterialiseResult = { ok: true; value: Materialised } | { ok: false; status: Unfaithful; reason: string };

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// A virtual name is "/a/b" or "c:/a/b"; below the root it is "<root>/a/b" or "<root>/c:/a/b".
export function toRealName(root: string, virtualName: string): string {
  if (virtualName.startsWith("/")) return virtualName === "/" ? root : root + virtualName;
  return root + "/" + virtualName;
}

export function classify(fsx: HarnessFs, currentDirectory: string, libFiles: Map<string, Uint8Array> | undefined, root: string, platform: Platform): { status: Unfaithful; reason: string } | undefined {
  const names = [...fsx.entries.keys(), currentDirectory];
  const drive = names.find(n => /^[a-zA-Z]:/.test(n));
  if (drive !== undefined) return { status: "drive-root", reason: `${drive} has a drive root, which a directory cannot stand for` };
  if (!fsx.useCaseSensitiveFileNames && platform.caseSensitive) return { status: "case-insensitive-instance", reason: "the instance asks for a file system that ignores case and the disk does not" };
  if (!platform.caseSensitive) {
    const seen = new Map<string, string>();
    for (const n of names) {
      let prefix = "";
      for (const p of n.split("/").slice(1)) {
        prefix += "/" + p;
        const k = prefix.toLowerCase();
        const other = seen.get(k);
        if (other !== undefined && other !== prefix) return { status: "case-clash", reason: `${other} and ${prefix} differ only in case` };
        seen.set(k, prefix);
      }
    }
  }
  if (!platform.preservesNames) {
    const n = names.find(x => x.normalize("NFC") !== x || x.normalize("NFD") !== x);
    if (n !== undefined) return { status: "unicode-normalisation", reason: `${n} has more than one normal form` };
  }
  if (platform.windows) {
    for (const n of names) {
      for (const p of n.split("/")) {
        if (p === "") continue;
        if (/[<>:"|?*\u0000-\u001f\\]/.test(p) || /[. ]$/.test(p) || reserved.test(p)) return { status: "windows-name", reason: `${n}: Windows rejects the name ${JSON.stringify(p)}` };
      }
    }
  }
  if (!platform.links && [...fsx.entries.values()].some(e => e.kind === "symlink")) return { status: "links-unavailable", reason: "the instance has links and the platform gives no right to make one" };
  if (platform.maxPath > 0) {
    const all = [...names, ...(libFiles?.keys() ?? [])];
    const long = all.find(n => root.length + n.length > platform.maxPath);
    if (long !== undefined) return { status: "path-too-long", reason: `${long} below ${root} is longer than ${platform.maxPath}` };
  }
  return undefined;
}

export function materialise(fsx: HarnessFs, currentDirectory: string, libFiles: Map<string, Uint8Array> | undefined, root: string, platform: Platform): MaterialiseResult {
  const c = classify(fsx, currentDirectory, libFiles, root, platform);
  if (c !== undefined) return { ok: false, ...c };
  // The model decides where each entry really lies, as the reference does when a directory on the way is a link.
  const input = new Map<string, MemInput>(fsx.entries);
  if (fsx.includeLibDir && libFiles !== undefined) for (const [name, data] of libFiles) input.set(name, { kind: "file", data });
  let model: MemFs;
  try {
    model = new MemFs(input, fsx.useCaseSensitiveFileNames);
  } catch (e) {
    if (e instanceof MemFsPanic) return { ok: false, status: "invalid-file-system", reason: e.message };
    throw e;
  }
  mkdirSync(root, { recursive: true });
  const entries = [...model.m.values()];
  for (const e of entries) if (e.kind === "dir") mkdirSync(root + "/" + e.realpath, { recursive: true });
  for (const e of entries) {
    if (e.kind !== "file") continue;
    mkdirSync(dirname(root + "/" + e.realpath), { recursive: true });
    writeFileSync(root + "/" + e.realpath, e.data);
  }
  for (const e of entries) {
    if (e.kind !== "symlink") continue;
    const at = root + "/" + e.realpath;
    mkdirSync(dirname(at), { recursive: true });
    const target = root + "/" + e.target;
    const st = model.getFollowingSymlinks(model.canonical(e.target)).entry;
    symlinkSync(relative(dirname(at), target), at, st !== undefined && st.kind === "dir" ? "dir" : "file");
  }
  const cwd = toRealName(root, currentDirectory);
  mkdirSync(cwd, { recursive: true });
  return { ok: true, value: mapping(root, cwd, fsx.programFileNames.map(n => toRealName(root, n))) };
}

export function mapping(root: string, currentDirectory: string, roots: string[]): Materialised {
  // the two spellings of the root that a process can print
  let real = root;
  try {
    real = realpathSync.native(root);
  } catch {}
  const spellings = [...new Set([root, real])].sort((a, b) => b.length - a.length);
  const norm = (p: string) => (sep === "\\" ? p.replaceAll("\\", "/") : p);
  const toVirtual = (realPath: string): string | undefined => {
    const p = norm(realPath);
    for (const s of spellings.map(norm)) {
      if (p === s) return "/";
      if (p.startsWith(s + "/")) {
        const rest = p.slice(s.length);
        return /^\/[a-zA-Z]:(\/|$)/.test(rest) ? rest.slice(1) : rest;
      }
    }
    return undefined;
  };
  const mapText = (text: string): string => {
    let out = text;
    for (const s of spellings) {
      const variants = sep === "\\" ? [s, norm(s)] : [s];
      for (const v of variants) {
        out = out.split(v + "/").join("/").split(v + "\\").join("/");
        out = out.split(v).join("/");
      }
    }
    return out.replace(/(^|[^A-Za-z0-9_./-])\/([a-zA-Z]:\/)/g, "$1$2");
  };
  return { root, currentDirectory, roots, toReal: n => toRealName(root, n), toVirtual, mapText };
}

// What the disk below a directory does; each probe leaves nothing behind that a later instance can see.
export function probePlatform(dir: string): Platform {
  mkdirSync(dir, { recursive: true });
  const probe = dir + "/.probe-Case";
  writeFileSync(probe, "");
  const caseSensitive = !existsSync(dir + "/.probe-case");
  const composed = dir + "/.probe-\u00e9";
  writeFileSync(composed, "");
  const preservesNames = readdirSync(dir).includes(".probe-\u00e9") && !existsSync(dir + "/.probe-e\u0301");
  let links = true;
  try {
    symlinkSync(".probe-Case", dir + "/.probe-link", "file");
  } catch {
    links = false;
  }
  const windows = process.platform === "win32";
  return { caseSensitive, preservesNames, links, windows, maxPath: windows ? 259 : 4095 };
}

// No directory above the root may hold what a resolver looks for on its way up.
export function ancestorPollution(root: string): string | undefined {
  let dir = dirname(root);
  for (;;) {
    for (const name of ["node_modules", "package.json", "tsconfig.json", "jsconfig.json"]) {
      if (existsSync(dir + "/" + name)) return dir + "/" + name;
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

// Reads the tree back: relative name to bytes, link or directory mark.
export function readBack(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = dir + "/" + name;
      const r = rel + "/" + name;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.set(r, "link:" + readlinkSync(p));
      else if (st.isDirectory()) {
        out.set(r, "dir");
        walk(p, r);
      } else out.set(r, "file:" + Bun.hash(readFileSync(p)).toString(16) + ":" + st.size);
    }
  };
  walk(root, "");
  return out;
}
export { getRootLength };
