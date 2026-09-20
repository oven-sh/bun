import type { Image, Tool } from "../image.ts";

export function bun(image: Image, pin: { version: string }): Tool {
  const triplet =
    image.os === "linux"
      ? `bun-linux-${image.arch}${image.abi === "musl" ? "-musl" : ""}`
      : `bun-${image.os}-${image.arch}`;
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${pin.version}/${triplet}.zip`;
  return {
    name: "bun",
    script: { linux: "linux/bun.sh", windows: "windows/bun.ps1", darwin: "macos/bun.sh" }[image.os],
    variables: { BUN_URL: url, BUN_TRIPLET: triplet },
  };
}
