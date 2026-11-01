import { Glob } from "bun";

const pattern = new Glob("**/*{.test,.spec,_test,_spec}.{js,jsx,cjs,mjs,ts,tsx,cts,mts}");

/**
 * The test files below `directory` by name, to go behind `bun test`. It sorts only those of the working folder itself: those of a
 * folder below run as the file system lists them, which is the newest first on a tmpfs.
 */
export const testFilesOf = (directory: string) =>
  [...pattern.scanSync({ cwd: directory })]
    .map(path => path.replaceAll("\\", "/"))
    .filter(path => !path.split("/").includes("node_modules"))
    .sort()
    .map(path => `./${path}`);
