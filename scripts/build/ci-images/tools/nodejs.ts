import type { LinuxImage, Tool } from "../image.ts";

/** Node.js, its headers, and the node-gyp cache that lets native addons build offline. */
export function nodejs(image: LinuxImage, pin: { version: string; nodeGypInstallVersion: string }): Tool {
  const { version } = pin;
  const arch = image.arch === "x64" ? "x64" : "arm64";
  // nodejs.org only ships glibc builds.
  const url =
    image.abi === "musl"
      ? `https://unofficial-builds.nodejs.org/download/release/v${version}/node-v${version}-linux-${arch}-musl.tar.gz`
      : `https://nodejs.org/dist/v${version}/node-v${version}-linux-${arch}.tar.gz`;
  const headersUrl = `https://nodejs.org/download/release/v${version}/node-v${version}-headers.tar.gz`;
  return {
    name: "nodejs",
    script: "linux/nodejs.sh",
    variables: {
      NODEJS_VERSION: version,
      NODEJS_URL: url,
      NODEJS_HEADERS_URL: headersUrl,
      NODE_GYP_INSTALL_VERSION: pin.nodeGypInstallVersion,
    },
    urls: [url, headersUrl],
  };
}
