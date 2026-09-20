import type { LinuxImage, Tool } from "../image.ts";

/** Kitware's installer has no musl build, so Alpine gets the distro's package. */
export function cmake(image: LinuxImage, pin: { version: string }): Tool {
  if (image.abi === "musl") {
    return { name: "cmake", script: "linux/cmake.apk.sh", variables: {}, urls: [] };
  }
  const arch = image.arch === "x64" ? "x86_64" : "aarch64";
  const url = `https://github.com/Kitware/CMake/releases/download/v${pin.version}/cmake-${pin.version}-linux-${arch}.sh`;
  return {
    name: "cmake",
    script: "linux/cmake.sh",
    variables: { CMAKE_URL: url, CMAKE_VERSION: pin.version },
    urls: [url],
  };
}
