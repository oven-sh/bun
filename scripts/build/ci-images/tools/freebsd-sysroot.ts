import type { Tool } from "../image.ts";

/** `/opt/freebsd-sysroot` and `/opt/freebsd-sysroot-arm64`, where scripts/build looks for them. */
export function freebsdSysroot(pin: { version: string; baseUrl: string }): Tool {
  const url = (arch: string) => `${pin.baseUrl}/${arch}/${pin.version}-RELEASE/base.txz`;
  return {
    name: "freebsd-sysroot",
    script: "linux/freebsd-sysroot.sh",
    variables: { FREEBSD_AMD64_URL: url("amd64"), FREEBSD_ARM64_URL: url("arm64") },
    urls: [url("amd64"), url("arm64")],
  };
}
