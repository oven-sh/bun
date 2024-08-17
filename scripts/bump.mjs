import { parseSemver } from "./util/format.mjs";
import { join, relative, dirname, readFile, writeFile } from "./util/fs.mjs";
import { print, fatalError } from "./util/util.mjs";

const arg = process.argv[2];
const actions = ["major", "minor", "patch"];
if (arg && !actions.includes(arg)) {
  fatalError(`Usage: ${relative(process.argv[1])} [major|minor|patch]`);
}

const cwd = dirname(import.meta.dirname);
const latestPath = join(cwd, "LATEST");
const actionIndex = actions.indexOf(arg ?? "patch");
const action = actions[actionIndex];
const oldVersion = parseSemver(readFile(latestPath));
const version = oldVersion.map((value, index) => (index === actionIndex ? value + 1 : value));

writeFile(latestPath, version.join("."));
print(`Bumping ${action} version from ${oldVersion.join(".")} to ${version.join(".")}`);
