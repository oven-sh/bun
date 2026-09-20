import type { MacosImage, Tool } from "../image.ts";

/** Where Homebrew lives: it chose a new prefix for Apple Silicon. */
export function brewPrefix(image: MacosImage): string {
  return image.arch === "aarch64" ? "/opt/homebrew" : "/usr/local";
}

/** Homebrew on PATH for the rest of the script and for every login shell. */
export function brew(image: MacosImage): Tool {
  return { name: "brew", script: "macos/brew.sh", variables: { BREW_PREFIX: brewPrefix(image) } };
}

/** Homebrew formulae, at whatever version Homebrew serves that day. */
export function brewPackages(names: readonly string[]): Tool {
  return { name: "packages", script: "macos/packages.sh", variables: { PACKAGES: names.join(" ") } };
}
