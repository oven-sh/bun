import type { LinuxImage, Tool } from "../image.ts";

/** Encrypts the core dumps a failed test uploads. */
export function age(image: LinuxImage, pin: { version: string; sha256: { x64: string; aarch64: string } }): Tool {
  const arch = image.arch === "x64" ? "amd64" : "arm64";
  const url = `https://github.com/FiloSottile/age/releases/download/v${pin.version}/age-v${pin.version}-linux-${arch}.tar.gz`;
  return {
    name: "age",
    script: "linux/age.sh",
    variables: { AGE_URL: url, AGE_SHA256: pin.sha256[image.arch] },
    urls: [url],
  };
}
