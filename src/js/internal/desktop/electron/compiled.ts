// The scripts of pages, workers and utility processes that were compiled into the executable.
const isCompiled = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmIsCompiled", 1);
const run = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmRunCompiled", 2);

/** The start of a URL, and the directory in the executable that has its files. */
const roots: [string, string][] = [];

function pathOf(url: string): string | undefined {
  for (const [prefix, directory] of roots) {
    if (!url.startsWith(prefix)) continue;
    const path = directory + url.slice(prefix.length).replace(/[?#].*/s, "");
    if (isCompiled(path)) return path;
  }
}

/** `isExclusive`: pages run these, the inline scripts that their documents came with, and nothing else. */
export default {
  roots,
  pathOf,
  run,
  isExclusive: false,
  /** The text of a module that is part of the program without being compiled. */
  sourceOf: undefined as ((url: string) => string | undefined | Promise<string | undefined>) | undefined,
};
