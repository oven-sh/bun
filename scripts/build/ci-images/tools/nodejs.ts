import type { Image, Tool } from "../image.ts";

/** Node.js, its headers, and the node-gyp cache that lets native addons build offline. */
export function nodejs(image: Image, pin: { version: string; nodeGypInstallVersion: string }): Tool {
  const { version } = pin;
  const arch = image.arch === "x64" ? "x64" : "arm64";
  const headersUrl = `https://nodejs.org/download/release/v${version}/node-v${version}-headers.tar.gz`;
  if (image.os === "windows") {
    // node.lib: what a native addon links against on Windows.
    const libUrl = `https://nodejs.org/dist/v${version}/win-${arch}/node.lib`;
    return {
      name: "nodejs",
      script: "windows/nodejs.ps1",
      variables: {
        NODEJS_VERSION: version,
        NODEJS_ARCH: arch,
        NODEJS_HEADERS_URL: headersUrl,
        NODEJS_LIB_URL: libUrl,
        NODE_GYP_INSTALL_VERSION: pin.nodeGypInstallVersion,
      },
    };
  }
  // nodejs.org only ships glibc builds.
  const url =
    image.abi === "musl"
      ? `https://unofficial-builds.nodejs.org/download/release/v${version}/node-v${version}-linux-${arch}-musl.tar.gz`
      : `https://nodejs.org/dist/v${version}/node-v${version}-linux-${arch}.tar.gz`;
  return {
    name: "nodejs",
    script: "linux/nodejs.sh",
    variables: {
      NODEJS_VERSION: version,
      NODEJS_URL: url,
      NODEJS_HEADERS_URL: headersUrl,
      NODE_GYP_INSTALL_VERSION: pin.nodeGypInstallVersion,
    },
  };
}
