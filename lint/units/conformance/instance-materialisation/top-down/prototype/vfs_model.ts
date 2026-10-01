// Prototype: the part of vfstest.MapFS (case sensitive) that the config file matcher reads: entries of a directory and real paths.
import { getRootLength, normalizePath, removeTrailingDirectorySeparator } from "../../../enumerator/prototype/tspath";
import { compareBytes } from "./tspath_more";

type Node = { kind: "file"; realpath: string } | { kind: "dir"; realpath: string } | { kind: "symlink"; realpath: string; target: string };

export interface Entries {
  files: string[];
  directories: string[];
  symlinks: Set<string>;
}

// vfstest.go:187
function comparePathsByParts(a: string, b: string): number {
  for (;;) {
    const ai = a.indexOf("/");
    const bi = b.indexOf("/");
    if (ai < 0 || bi < 0) return compareBytes(a, b);
    const r = compareBytes(a.slice(0, ai), b.slice(0, bi));
    if (r !== 0) return r;
    a = a.slice(ai + 1);
    b = b.slice(bi + 1);
  }
}

export class MapFS {
  // keys have no leading "/"; a DOS path keeps its volume as the first segment
  private m = new Map<string, Node>();
  private symlinks = new Map<string, string>();
  readonly useCaseSensitiveFileNames = true;
  // set when a lookup met more than one link that is a prefix of the path; Go picks one at random there
  ambiguous = false;

  // vfstest.go:80 and :143; files maps an absolute normalized path to anything, links maps a link to its target
  constructor(files: Iterable<string>, links: Map<string, string>) {
    const input = new Map<string, Node>();
    for (const p of files) input.set(cut(p), { kind: "file", realpath: cut(p) });
    for (const [l, t] of links) input.set(cut(l), { kind: "symlink", realpath: cut(l), target: cut(t) });
    const keys = [...input.keys()].sort(comparePathsByParts);
    for (const p of keys) {
      const node = input.get(p)!;
      const dir = dirName(p);
      if (dir !== "") this.mkdirAll(dir);
      this.setEntry(p, node);
    }
  }

  private setEntry(p: string, node: Node) {
    this.m.set(p, node);
    if (node.kind === "symlink") this.symlinks.set(p, node.target);
  }

  // vfstest.go:261
  private getFollowingSymlinks(p: string, depth = 0): { node: Node | undefined; path: string; broken: boolean } {
    if (depth > 64) return { node: undefined, path: p, broken: true };
    const file = this.m.get(p);
    if (file !== undefined && file.kind !== "symlink") return { node: file, path: p, broken: false };
    const target = this.symlinks.get(p);
    if (target !== undefined) {
      const r = this.getFollowingSymlinks(target, depth + 1);
      return r.node === undefined ? { node: undefined, path: r.path, broken: true } : r;
    }
    const prefixes: [string, string][] = [];
    for (const [other, t] of this.symlinks) {
      if (other.length < p.length && p.startsWith(other) && p[other.length] === "/") prefixes.push([other, t]);
    }
    if (prefixes.length > 1) this.ambiguous = true;
    if (prefixes.length > 0) {
      const [other, t] = prefixes[0];
      const r = this.getFollowingSymlinks(t + p.slice(other.length), depth + 1);
      return r.node === undefined ? { node: undefined, path: r.path, broken: true } : r;
    }
    return { node: undefined, path: p, broken: false };
  }

  // vfstest.go:325
  private mkdirAll(p: string) {
    const found = this.getFollowingSymlinks(p);
    if (found.node !== undefined) return;
    let toCreate: string[] = [];
    let offset = 0;
    for (;;) {
      const idx = p.indexOf("/", offset);
      const dir = idx < 0 ? p : p.slice(0, idx);
      const rest = idx < 0 ? "" : p.slice(idx + 1);
      const other = this.getFollowingSymlinks(dir);
      if (other.node === undefined) {
        if (other.broken) return;
        toCreate.push(dir);
      } else {
        if (other.node.kind !== "dir") return;
        if (dir !== other.path) {
          p = other.node.realpath + "/" + rest;
          toCreate = [];
          offset = 0;
          continue;
        }
      }
      if (rest === "") break;
      offset = dir.length + 1;
    }
    for (const dir of toCreate) this.setEntry(dir, { kind: "dir", realpath: dir });
  }

  private stat(absolutePath: string): Node | undefined {
    return this.getFollowingSymlinks(key(absolutePath)).node;
  }

  fileExists(absolutePath: string): boolean {
    return this.stat(absolutePath)?.kind === "file";
  }

  directoryExists(absolutePath: string): boolean {
    return this.stat(absolutePath)?.kind === "dir";
  }

  // iofs.go:190 over vfstest.go:470
  realpath(absolutePath: string): string {
    const p = split(absolutePath);
    const r = this.getFollowingSymlinks(key(absolutePath));
    if (r.node === undefined) return absolutePath;
    return p.startsWith("/") ? "/" + r.node.realpath : r.node.realpath;
  }

  // internal.go:68 over fstest.MapFS.ReadDir, which sorts the names of a directory in byte order
  getAccessibleEntries(absolutePath: string): Entries {
    const result: Entries = { files: [], directories: [], symlinks: new Set() };
    const dir = this.getFollowingSymlinks(key(absolutePath));
    if (dir.node === undefined || dir.node.kind !== "dir") {
      if (key(absolutePath) !== "") return result;
    }
    const base = dir.node === undefined ? "" : dir.path;
    const prefix = base === "" ? "" : base + "/";
    const names: string[] = [];
    for (const key of this.m.keys()) {
      if (!key.startsWith(prefix) || key.length === prefix.length) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes("/")) continue;
      names.push(rest);
    }
    names.sort(compareBytes);
    for (const name of names) {
      const node = this.m.get(prefix + name)!;
      if (node.kind === "dir") result.directories.push(name);
      else if (node.kind === "file") result.files.push(name);
      else {
        const target = this.getFollowingSymlinks(prefix + name).node;
        if (target === undefined) continue;
        if (target.kind === "dir") result.directories.push(name);
        else result.files.push(name);
        result.symlinks.add(name);
      }
    }
    return result;
  }
}

function cut(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

// internal.go:30, joined again as iofs.go does
function split(p: string): string {
  p = normalizePath(p);
  const l = getRootLength(p);
  return p.slice(0, l) + removeTrailingDirectorySeparator(p.slice(l));
}

// the key of the map for an absolute path: no leading "/" and no trailing "/"
function key(absolutePath: string): string {
  return removeTrailingDirectorySeparator(cut(split(absolutePath)));
}

function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
