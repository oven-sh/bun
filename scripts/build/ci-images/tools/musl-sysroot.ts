import type { LinuxImage, Tool } from "../image.ts";

/**
 * `/opt/linux-sysroot-musl` and `-arm64`, filled from Alpine's own packages
 * so the libstdc++ is the one the Alpine test images run. The release is the
 * Alpine images' release; the package versions are the day's.
 */
export function muslSysroot(image: LinuxImage, pin: { alpineRelease: string }): Tool {
  const repository = `https://dl-cdn.alpinelinux.org/alpine/v${pin.alpineRelease}/main`;
  const host = image.arch === "x64" ? "x86_64" : "aarch64";
  const index = `${repository}/${host}/APKINDEX.tar.gz`;
  return {
    name: "musl-sysroot",
    script: "linux/musl-sysroot.sh",
    variables: { ALPINE_REPOSITORY: repository, ALPINE_HOST_ARCH: host },
    urls: [index],
  };
}
