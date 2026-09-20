import type { Image, Tool } from "../image.ts";

/**
 * `/etc/bun-image.json` (`C:\bun-image.json`): what this image is, the name it
 * was baked under, and the exact packages the bake installed. It is written
 * when every install is done, and is not part of the image's name.
 */
export function recordImage(image: Image): Tool {
  return {
    name: "record-image",
    script: image.os === "windows" ? "windows/record-image.ps1" : "linux/record-image.sh",
    variables: { IMAGE_RECORD: image.os === "windows" ? "C:\\bun-image.json" : "/etc/bun-image.json" },
    files: { "record-image.mts": "scripts/build/ci-images/tools/record-image.mts" },
  };
}
