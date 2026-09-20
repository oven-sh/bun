import type { Image, Tool } from "../image.ts";

function asset(image: Image): string {
  const arch = image.arch === "x64" ? "x86_64" : "aarch64";
  switch (image.os) {
    case "linux":
      return `curl-linux-${arch}-${image.abi === "musl" ? "musl" : "glibc"}`;
    case "windows":
      return `curl-windows-${arch}`;
    case "darwin":
      return `curl-macos-${image.arch === "x64" ? "x86_64" : "arm64"}`;
  }
}

/**
 * A static curl built with HTTP/3, installed as `curl-h3` beside the system
 * curl. The HTTP/3 tests find it through `$CURL_HTTP3`.
 */
export function curlH3(image: Image, pin: { version: string }): Tool {
  const url = `https://github.com/stunnel/static-curl/releases/download/${pin.version}/${asset(image)}-${pin.version}.tar.xz`;
  return {
    name: "curl-h3",
    script: { linux: "linux/curl-h3.sh", windows: "windows/curl-h3.ps1", darwin: "macos/curl-h3.sh" }[image.os],
    variables: { CURL_H3_URL: url },
  };
}
