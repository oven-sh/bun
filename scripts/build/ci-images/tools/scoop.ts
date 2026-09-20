import type { Tool } from "../image.ts";

/** The package manager the Windows images install most tools with. Its own version is the day's. */
export function scoop(): Tool {
  const url = "https://get.scoop.sh";
  return { name: "scoop", script: "windows/scoop.ps1", variables: { SCOOP_INSTALL_URL: url }, urls: [url] };
}

/** Packages from Scoop's main bucket, in order. Their versions are whatever the bucket serves on the day of the bake. */
export function scoopPackages(names: readonly string[]): Tool {
  return {
    name: "scoop-packages",
    script: "windows/scoop-packages.ps1",
    variables: { SCOOP_PACKAGES: names.join(" ") },
    urls: [],
  };
}
