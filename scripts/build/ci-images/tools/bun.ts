import type { LinuxImage, Tool } from "../image.ts";

export function bun(image: LinuxImage, pin: { version: string }): Tool {
  const triplet = `bun-linux-${image.arch}${image.abi === "musl" ? "-musl" : ""}`;
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${pin.version}/${triplet}.zip`;
  return {
    name: "bun",
    script: "linux/bun.sh",
    variables: { BUN_VERSION: pin.version, BUN_URL: url, BUN_TRIPLET: triplet },
    urls: [url],
  };
}
