import path from "path";

process.chdir(path.join(import.meta.dir, "../"));

const git_branch = await Bun.$`git rev-parse --abbrev-ref HEAD`.text();

if (git_branch.trim() !== "main") {
  console.error("You must be on the main branch to run this script");
  process.exit(1);
}

const kinds = ["major", "minor", "patch"];
const increment = kinds.findIndex(type => process.argv[2] === type);
if (increment === -1) {
  console.error("Usage: bun bump <major|minor|patch>");
  process.exit(1);
}

const cmakelists = await Bun.file("./CMakeLists.txt").text();

const found_version_line = cmakelists.indexOf("set(Bun_VERSION");
if (found_version_line === -1) {
  throw new Error("Could not find version line in CMakeLists.txt");
}

const version = /set\(Bun_VERSION "([0-9]+\.[0-9]+\.[0-9]+)"/.exec(cmakelists);
if (!version) {
  throw new Error("Could not find version in CMakeLists.txt");
}

const to_arg = process.argv.find(arg => arg.startsWith("--last-version="));
const to = to_arg ? to_arg.slice("--last-version=".length) : version[1];

const updated_version = to
  .split(".")
  .map((v, i) => (i === increment ? parseInt(v) + 1 : i < increment ? parseInt(v) : 0))
  .join(".");

await Bun.write("./CMakeLists.txt", cmakelists.replace(version[1], updated_version));
await Bun.write("LATEST", to);

console.log("Bumping version from %s to %s", version[1], updated_version);
