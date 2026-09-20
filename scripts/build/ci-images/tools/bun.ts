import type { Image, Tool } from "../image.ts";

export function bun(image: Image, pin: { version: string }): Tool {
  const triplet =
    image.os === "windows"
      ? `bun-windows-${image.arch}`
      : `bun-linux-${image.arch}${image.abi === "musl" ? "-musl" : ""}`;
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${pin.version}/${triplet}.zip`;
  return {
    name: "bun",
    script: image.os === "windows" ? "windows/bun.ps1" : "linux/bun.sh",
    variables: { BUN_URL: url, BUN_TRIPLET: triplet },
  };
}
