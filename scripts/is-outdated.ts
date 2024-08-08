import { join } from "path";
const body = process.env.GITHUB_ISSUE_BODY;
if (!body) {
  throw new Error("GITHUB_ISSUE_BODY must be set");
}

const latest = (await Bun.file(join(import.meta.dir, "..", "LATEST")).text()).trim();

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
      await Bun.write("is-outdated.txt", "true");
      await Bun.write("outdated.txt", version);
      process.exit(0);
    }
  }
}
