import type { Image, Tool } from "../image.ts";

/**
 * A static curl built with HTTP/3, installed as `curl-h3` beside the system
 * curl. The HTTP/3 tests find it through `$CURL_HTTP3`.
 */
export function curlH3(image: Image, pin: { version: string }): Tool {
  const arch = image.arch === "x64" ? "x86_64" : "aarch64";
  const platform = image.os === "windows" ? "windows" : `linux-${arch}-${image.abi === "musl" ? "musl" : "glibc"}`;
  const asset = image.os === "windows" ? `curl-windows-${arch}` : `curl-${platform}`;
  const url = `https://github.com/stunnel/static-curl/releases/download/${pin.version}/${asset}-${pin.version}.tar.xz`;
  return {
    name: "curl-h3",
    script: image.os === "windows" ? "windows/curl-h3.ps1" : "linux/curl-h3.sh",
    variables: { CURL_H3_URL: url },
    urls: [url],
  };
}
