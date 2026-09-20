import type { Tool } from "../image.ts";

/**
 * `/opt/linux-sysroot-glibc` and `-arm64`: Ubuntu 20.04's glibc 2.31 with
 * gcc-13's libstdc++, the environment the prebuilt WebKit is compiled in.
 * Every linux-gnu build links against it so no symbol is newer than 2.31.
 *
 * The `ubuntu:20.04` tag and the focal package index are whatever they are
 * on the day of the bake.
 */
export function glibcSysroot(pin: { gccDebsUrl: string }): Tool {
  const debs = (arch: string) => `${pin.gccDebsUrl}/gcc-13-focal-${arch}.tar.gz`;
  return {
    name: "glibc-sysroot",
    script: "linux/glibc-sysroot.sh",
    variables: { GCC_DEBS_AMD64_URL: debs("amd64"), GCC_DEBS_ARM64_URL: debs("arm64") },
    urls: [debs("amd64"), debs("arm64")],
  };
}
