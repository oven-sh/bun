import fs from "node:fs";
import { createRequire } from "node:module";

/** Candidates found in the module graph. Opaque: only the native module reads it. */
export type TailwindContext = { readonly __brand: "TailwindContext" };

export interface NativeModule {
  twctxCreate(): TailwindContext;
  /**
   * The distinct candidates of the modules inside `directory`, if there is one, that no pattern of `excluded` covers: a
   * directory, or a glob. All are absolute paths with `/` separators.
   */
  twctxCandidates(context: TailwindContext, directory: string | null, excluded: string[]): string[];
}

function isMusl(): boolean {
  try {
    return fs.readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    return false;
  }
}

const builds: Record<string, (() => string[]) | undefined> = {
  "android-arm64": () => ["android-arm64"],
  "darwin-arm64": () => ["darwin-arm64"],
  "darwin-x64": () => ["darwin-x64"],
  "linux-arm64": () => (isMusl() ? ["linux-arm64-musl", "linux-arm64-gnu"] : ["linux-arm64-gnu", "linux-arm64-musl"]),
  "linux-x64": () => (isMusl() ? ["linux-x64-musl", "linux-x64-gnu"] : ["linux-x64-gnu", "linux-x64-musl"]),
  "win32-arm64": () => ["win32-arm64-msvc"],
  "win32-x64": () => ["win32-x64-msvc"],
};

function load(): NativeModule | null {
  const platform = `${process.platform}-${process.arch}`;
  const names = builds[platform]?.();
  if (!names) return null;

  const require = createRequire(import.meta.url);
  const errors: unknown[] = [];
  for (const name of names) {
    try {
      return require(`../bun-plugin-tailwind.${name}.node`);
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, `bun-plugin-tailwind could not load its native module for ${platform}`);
}

/** `null` on a platform it is not built for. Tailwind then only finds the classes of files on disk. */
export const native: NativeModule | null = load();
