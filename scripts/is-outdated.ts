import { join } from "path";
const body = process.env.GITHUB_ISSUE_BODY;
if (!body) {
  throw new Error("GITHUB_ISSUE_BODY must be set");
}

const latest = (await Bun.file(join(import.meta.dir, "..", "LATEST")).text()).trim();

const lines = body.split("\n").reverse();

for (let line of lines) {
  line = line.trim().toLowerCase();
  if (line.startsWith("bun v") && line.includes(" on ")) {
    const version = line.slice("bun v".length, line.indexOf(" ", "bun v".length)).toLowerCase().trim();

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

    console.log({
      latest,
      version,
    });

    if (Bun.semver.order(latest, version) === 1) {
      const [major, minor, patch, ...rest] = version.split(".").map(Number);
      const [latestMajor, latestMinor, latestPatch, ...latestRest] = latest.split(".").map(Number);

      await Bun.write("is-outdated.txt", "true");
      await Bun.write("outdated.txt", version);

      const isVeryOutdated =
        major !== latestMajor || minor !== latestMinor || (latestPatch > patch && latestPatch - patch > 3);

      if (isVeryOutdated) {
        console.log("Very outdated");
        await Bun.write("is-very-outdated.txt", "true");
      }

      process.exit(0);
    }
  }
}
