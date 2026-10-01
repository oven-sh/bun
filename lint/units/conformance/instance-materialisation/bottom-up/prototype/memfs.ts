// Research prototype: the in-memory file system of the harness (vfstest.FromMap behind iovfs.From), reads only.
import { getRootLength, isRootedDiskPath, normalizePath, removeTrailingDirectorySeparator } from "./tspath";
import { compareStringsCaseSensitive, getCanonicalFileName } from "./tspath_more";

export type MemEntry =
  | { kind: "file"; data: Uint8Array; realpath: string }
  | { kind: "dir"; realpath: string }
  | { kind: "symlink"; target: string; realpath: string };

export type MemInput = { kind: "file"; data: Uint8Array } | { kind: "symlink"; target: string };

export interface Entries {
  files: string[];
  directories: string[];
  symlinks: Set<string>;
}

export class MemFsPanic extends Error {}

// vfstest.go:185
function comparePathsByParts(a: string, b: string): number {
  for (;;) {
    const ai = a.indexOf("/");
    const bi = b.indexOf("/");
    if (ai < 0 || bi < 0) return compareStringsCaseSensitive(a, b);
    const r = compareStringsCaseSensitive(a.slice(0, ai), b.slice(0, bi));
    if (r !== 0) return r;
    a = a.slice(ai + 1);
    b = b.slice(bi + 1);
  }
}

function cutSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export class MemFs {
  // keys are canonical paths without the leading slash
  readonly m = new Map<string, MemEntry>();
  readonly symlinks = new Map<string, string>();
  posix = false;

  constructor(input: Map<string, MemInput>, readonly useCaseSensitiveFileNames: boolean) {
    let posix = false;
    let windows = false;
    const checkPath = (p: string) => {
      if (!isRootedDiskPath(p)) throw new MemFsPanic(`non-rooted path ${JSON.stringify(p)}`);
      if (removeTrailingDirectorySeparator(normalizePath(p)) !== p) throw new MemFsPanic(`non-normalized path ${JSON.stringify(p)}`);
      if (p.startsWith("/")) posix = true;
      else windows = true;
    };
    const mfs = new Map<string, MemInput>();
    for (const p of [...input.keys()].sort(comparePathsByParts)) {
      let f = input.get(p)!;
      checkPath(p);
      if (f.kind === "symlink") {
        checkPath(f.target);
        f = { kind: "symlink", target: cutSlash(f.target) };
      }
      mfs.set(cutSlash(p), f);
    }
    if (posix && windows) throw new MemFsPanic("mixed posix and windows paths");
    this.posix = posix;

    // convertMapFS
    const canonicalPaths = new Map<string, string>();
    for (const path of mfs.keys()) {
      const canonical = this.canonical(path);
      const other = canonicalPaths.get(canonical);
      if (other !== undefined) {
        const [x, y] = [path, other].sort(compareStringsCaseSensitive);
        throw new MemFsPanic(`duplicate path: ${JSON.stringify(x)} and ${JSON.stringify(y)} have the same canonical path`);
      }
      canonicalPaths.set(canonical, path);
    }
    for (const p of [...mfs.keys()].sort(comparePathsByParts)) {
      const file = mfs.get(p)!;
      const dir = dirName(p);
      if (dir !== "") {
        const err = this.mkdirAll(dir);
        if (err !== undefined) throw new MemFsPanic(`failed to create intermediate directories for ${JSON.stringify(p)}: ${err}`);
      }
      this.setEntry(p, this.canonical(p), file.kind === "file" ? { kind: "file", data: file.data, realpath: p } : { kind: "symlink", target: file.target, realpath: p });
    }
  }

  canonical(p: string): string {
    return getCanonicalFileName(p, this.useCaseSensitiveFileNames);
  }

  private setEntry(realpath: string, canonical: string, entry: MemEntry): void {
    if (realpath === "" || canonical === "") throw new MemFsPanic("empty path");
    this.m.set(canonical, { ...entry, realpath });
    if (entry.kind === "symlink") this.symlinks.set(canonical, this.canonical(entry.target));
  }

  // vfstest.go:262; the Go map walk over symlinks has no fixed order, here it is insertion order
  getFollowingSymlinks(p: string, from = "", depth = 0): { entry: MemEntry | undefined; path: string; broken: boolean } {
    if (depth > 64) return { entry: undefined, path: p, broken: true };
    const file = this.m.get(p);
    if (file !== undefined && file.kind !== "symlink") return { entry: file, path: p, broken: false };
    const target = this.symlinks.get(p);
    if (target !== undefined) return this.getFollowingSymlinks(target, p, depth + 1);
    for (const [other, t] of this.symlinks) {
      if (other.length < p.length && other === p.slice(0, other.length) && p[other.length] === "/") {
        return this.getFollowingSymlinks(t + p.slice(other.length), other, depth + 1);
      }
    }
    return { entry: undefined, path: p, broken: from !== "" };
  }

  // vfstest.go:325
  private mkdirAll(p: string): string | undefined {
    const fast = this.getFollowingSymlinks(this.canonical(p));
    if (fast.entry !== undefined) {
      if (fast.entry.kind !== "dir") return `mkdir ${JSON.stringify(p)}: path exists but is not a directory`;
      return undefined;
    }
    let toCreate: string[] = [];
    let offset = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const idx = p.indexOf("/", offset);
      const dir = idx < 0 ? p : p.slice(0, idx);
      const rest = idx < 0 ? "" : p.slice(idx + 1);
      const canonical = this.canonical(dir);
      const r = this.getFollowingSymlinks(canonical);
      if (r.entry === undefined) {
        if (r.broken) return `broken symlink`;
        toCreate.push(dir);
      } else {
        if (r.entry.kind !== "dir") return `mkdir ${JSON.stringify(r.path)}: path exists but is not a directory`;
        if (canonical !== r.path) {
          p = r.entry.realpath + "/" + rest;
          toCreate = [];
          offset = 0;
          continue;
        }
      }
      if (rest === "") break;
      offset = dir.length + 1;
    }
    for (const dir of toCreate) this.setEntry(dir, this.canonical(dir), { kind: "dir", realpath: dir });
    return undefined;
  }

  // internal.go:29 and iofs.go RootFor: "/" is the whole map, "c:/" is the sub tree "c:"
  private split(path: string): { root: string; rest: string } {
    const p = normalizePath(path);
    const l = getRootLength(p);
    if (l === 0) throw new MemFsPanic(`vfs: path ${JSON.stringify(path)} is not absolute`);
    return { root: p.slice(0, l), rest: removeTrailingDirectorySeparator(p.slice(l)) };
  }

  private key(path: string): string {
    const { root, rest } = this.split(path);
    if (root === "/") return rest === "" ? "." : rest;
    const sub = removeTrailingDirectorySeparator(root);
    return rest === "" ? sub : sub + "/" + rest;
  }

  stat(path: string): MemEntry | undefined {
    const k = this.key(path);
    if (k === ".") return { kind: "dir", realpath: "." };
    return this.getFollowingSymlinks(this.canonical(k)).entry;
  }

  fileExists(path: string): boolean {
    const s = this.stat(path);
    return s !== undefined && s.kind !== "dir";
  }

  directoryExists(path: string): boolean {
    const s = this.stat(path);
    return s !== undefined && s.kind === "dir";
  }

  readFile(path: string): Uint8Array | undefined {
    const s = this.stat(path);
    return s !== undefined && s.kind === "file" ? s.data : undefined;
  }

  // iofs.go:191 with vfstest.go:442
  realpath(path: string): string {
    const { root, rest } = this.split(path);
    const joined = root + rest;
    const hadSlash = joined.startsWith("/");
    const r = this.getFollowingSymlinks(this.canonical(cutSlash(joined)));
    if (r.entry === undefined) return path;
    return hadSlash ? "/" + r.entry.realpath : r.entry.realpath;
  }

  // internal.go:66; the entries of a directory come sorted by name
  getAccessibleEntries(path: string): Entries {
    const result: Entries = { files: [], directories: [], symlinks: new Set() };
    const k = this.key(path);
    let dirKey: string;
    if (k === ".") dirKey = "";
    else {
      const r = this.getFollowingSymlinks(this.canonical(k));
      if (r.entry === undefined || r.entry.kind !== "dir") return result;
      dirKey = r.path + "/";
    }
    const children: [string, MemEntry][] = [];
    for (const [key, entry] of this.m) {
      if (!key.startsWith(dirKey)) continue;
      const tail = key.slice(dirKey.length);
      if (tail === "" || tail.includes("/")) continue;
      children.push([tail, entry]);
    }
    // io/fs.ReadDir sorts by the name of the entry, which is the last element of the real path
    children.sort((a, b) => compareStringsCaseSensitive(baseName(a[1].realpath), baseName(b[1].realpath)));
    for (const [, entry] of children) {
      const name = baseName(entry.realpath);
      if (entry.kind === "dir") result.directories.push(name);
      else if (entry.kind === "file") result.files.push(name);
      else {
        const st = this.stat(path + "/" + name);
        if (st === undefined) continue;
        if (st.kind === "dir") result.directories.push(name);
        else if (st.kind === "file") result.files.push(name);
        else continue;
        result.symlinks.add(name);
      }
    }
    return result;
  }
}
