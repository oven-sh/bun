import type { LinuxImage, Tool } from "../image.ts";

/**
 * A static curl built with HTTP/3, installed as `curl-h3` beside the system
 * curl. The HTTP/3 tests find it through `$CURL_HTTP3`.
 */
export function curlH3(image: LinuxImage, pin: { version: string }): Tool {
  const arch = image.arch === "x64" ? "x86_64" : "aarch64";
  const libc = image.abi === "musl" ? "musl" : "glibc";
  const url = `https://github.com/stunnel/static-curl/releases/download/${pin.version}/curl-linux-${arch}-${libc}-${pin.version}.tar.xz`;
  return {
    name: "curl-h3",
    script: "linux/curl-h3.sh",
    variables: { CURL_H3_URL: url, CURL_H3_VERSION: pin.version },
    urls: [url],
  };
}
