import { describeCodeGraph, type CodeGraph, type CodeGraphFile } from "bun:internal-for-testing";
import { tempDir, type DirectoryTree } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

/** A `CodeGraphFile` whose paths under the root are relative to it and use `/`. */
export type TreeFile = CodeGraphFile;

export interface DescribeOptions {
  libraryRoots?: string[];
  conditions?: string[];
  threads?: number;
  defines?: Record<string, string | boolean>;
  features?: string[];
  /** Link path to target path, both relative to the root. Created before the load. */
  links?: Record<string, string>;
}

export interface TreeGraph extends Disposable {
  root: string;
  /** As returned: absolute paths, libraries included. */
  raw: CodeGraph;
  /** The files under the root, by ascending `FileId`. */
  paths: string[];
  entryPoints: string[];
  compiledFiles: string[];
  diagnostics: string[];
  has(path: string): boolean;
  file(path: string): TreeFile;
  answer(importer: string, specifier: string, kind?: "import" | "require"): string;
}

function withRelativePaths(file: CodeGraphFile, relativeTo: (text: string) => string): TreeFile {
  return {
    ...file,
    path: relativeTo(file.path),
    typeEdges: file.typeEdges.map(relativeTo),
    codeEdges: file.codeEdges.map(relativeTo),
    impliedAnswers: file.impliedAnswers.map(relativeTo),
    sites: file.sites.map(site => ({ ...site, answer: relativeTo(site.answer) })),
  };
}

export function describeTree(files: DirectoryTree, entryPoints: string[], options?: DescribeOptions): TreeGraph {
  const tree = tempDir("aot-loader", files);
  try {
    return { ...describeDirectory(String(tree), entryPoints, options), [Symbol.dispose]: () => tree[Symbol.dispose]() };
  } catch (error) {
    tree[Symbol.dispose]();
    throw error;
  }
}

export function describeDirectory(root: string, entryPoints: string[], options: DescribeOptions = {}): TreeGraph {
  const absolute = (path: string) => join(root, path);
  const relativeTo = (text: string) => {
    if (!isAbsolute(text)) return text;
    const path = relative(root, text);
    return path.startsWith("..") || isAbsolute(path) ? text : path.replaceAll("\\", "/");
  };

  for (const [link, target] of Object.entries(options.links ?? {})) {
    mkdirSync(dirname(absolute(link)), { recursive: true });
    symlinkSync(absolute(target), absolute(link), "junction");
  }

  const { libraryRoots, conditions, threads, defines, features } = options;
  const raw = describeCodeGraph(entryPoints.map(absolute), {
    workingDirectory: root,
    libraryRoots: libraryRoots?.map(absolute),
    conditions,
    threads,
    defines,
    features,
  });

  const files = new Map<string, TreeFile>();
  const paths: string[] = [];
  for (const rawFile of raw.files) {
    const treeFile = withRelativePaths(rawFile, relativeTo);
    files.set(treeFile.path, treeFile);
    if (treeFile.path !== rawFile.path) paths.push(treeFile.path);
  }

  const file = (path: string) => {
    const found = files.get(path);
    if (!found) throw new Error(`no file ${path} in the program:\n${paths.join("\n")}`);
    return found;
  };

  const answer = (importer: string, specifier: string, kind?: "import" | "require") => {
    const { sites } = file(importer);
    const matches = sites.filter(site => site.specifier === specifier && (kind === undefined || site.kind === kind));
    if (matches.length !== 1) {
      const wanted = JSON.stringify({ specifier, kind });
      throw new Error(`${matches.length} sites of ${importer} match ${wanted}:\n${JSON.stringify(sites, null, 2)}`);
    }
    return matches[0].answer;
  };

  return {
    root,
    raw,
    paths,
    entryPoints: raw.entryPoints.map(relativeTo),
    compiledFiles: raw.compiledFiles.map(relativeTo),
    diagnostics: raw.diagnostics,
    has: path => files.has(path),
    file,
    answer,
    [Symbol.dispose]() {},
  };
}
