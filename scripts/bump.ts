import path from "path";

process.chdir(path.join(import.meta.dir, "../"));

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

const updated_version = version[1]
  .split(".")
  .map((v, i) => (i === increment ? parseInt(v) + 1 : i < increment ? parseInt(v) : 0))
  .join(".");

console.log("Bumping version from %s to %s", version[1], updated_version);

// remove all files from stage
await Bun.$`git reset`;

await Bun.write("./CMakeLists.txt", cmakelists.replace(version[1], updated_version));

await Bun.$`git add CMakeLists.txt`;
await Bun.$`git commit -m "Bump to v${updated_version}"`;

console.log("");
console.log("Done.");
