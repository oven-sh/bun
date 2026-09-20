// Runs on the machine being baked, as the last thing that looks at it, under
// the Node.js the bake installed:
//
//   node record-image.mts <image name> <output file>
//
// Writes what this image is: everything scripts/build/ci-images/spec.ts says
// about it (image.json, next to this file), the name it is baked under, and
// what the spec cannot know, the exact version of every package the distro's
// or Scoop's repositories served on the day of the bake.
//
// The file is for keying caches of build outputs on the machine that made
// them. It is written after the image's name is decided and never feeds it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [name, output] = process.argv.slice(2);
if (!name || !output) {
  throw new Error("usage: node record-image.mts <image name> <output file>");
}

const image = JSON.parse(readFileSync(join(import.meta.dirname, "image.json"), "utf8")) as {
  os: "linux" | "windows";
  distro?: "debian" | "ubuntu" | "alpine";
};

function lines(command: string, args: string[]): string[] {
  const { status, stdout, stderr, error } = spawnSync(command, args, {
    encoding: "utf8",
    shell: image.os === "windows",
  });
  if (error || status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr?.trim() ?? error?.message}`, { cause: error });
  }
  return stdout.split(/\r?\n/).filter(line => line.trim());
}

/** `name version`, one per package, sorted. */
function installedPackages(): string[] {
  if (image.os === "windows") {
    const { apps } = JSON.parse(lines("scoop", ["export"]).join("\n")) as { apps: { Name: string; Version: string }[] };
    return apps.map(app => `${app.Name} ${app.Version}`).sort();
  }
  if (image.distro === "alpine") {
    // `apk list` prints "name-version arch {origin} (license) [installed]".
    return lines("apk", ["list", "--installed"])
      .map(line => line.split(" ")[0]!.replace(/-([^-]+-r\d+)$/, " $1"))
      .sort();
  }
  return lines("dpkg-query", ["--show", "--showformat", "${Package} ${Version}\\n"]).sort();
}

const packages = installedPackages();
const record = {
  name,
  ...image,
  packages,
  packagesSha256: createHash("sha256").update(packages.join("\n")).digest("hex"),
};
writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
console.log(`${output}: ${name}, ${packages.length} packages, ${record.packagesSha256}`);
