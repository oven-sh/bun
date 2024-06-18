import { join } from "path";
const body = process.env.GITHUB_ISSUE_BODY;
if (!body) {
  throw new Error("GITHUB_ISSUE_BODY must be set");
}

const latest = await (async () => {
  const cmake = await Bun.file(join(import.meta.dir, "..", "CMakeLists.txt")).text();

  const startI = cmake.indexOf("Bun_VERSION");
  if (startI === -1) {
    throw new Error("CMakeLists.txt is missing a Bun version");
  }

  const endI = cmake.indexOf("\n", startI);
  if (endI === -1) {
    throw new Error("CMakeLists.txt is missing the end of the version");
  }

  const quote = cmake.indexOf('"', startI);
  if (quote === -1) {
    throw new Error("CMakeLists.txt is missing the start of the version");
  }

  const endQuote = cmake.indexOf('"', quote + 1);
  if (endQuote === -1) {
    throw new Error("CMakeLists.txt is missing the end of the version");
  }

  return cmake.slice(quote + 1, endQuote);
})();

console.write("latest=" + latest);

const lines = body.split("\n").reverse();
for (const line of lines) {
  if (line.startsWith("Bun v") && line.includes(" on ")) {
    const version = line.slice("Bun v".length, line.indexOf(" ", "Bun v".length)).toLowerCase();

    // Check if valid version
    if (version.includes("canary")) {
      process.exit(0);
    }

    if (!Bun.semver.satisfies(version, "*")) {
      console.warn("Version is not a valid semver");
      process.exit(1);
    }

    if (version === latest) {
      process.exit(0);
    }

    if (Bun.semver.order(latest, version) === 1) {
      console.write(",outdated=" + version);
      console.write(",is-outdated=true");
      process.exit(0);
    }
  }
}
