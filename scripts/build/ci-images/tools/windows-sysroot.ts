import type { LinuxImage, Tool } from "../image.ts";

/** `/opt/winsysroot`: the MSVC CRT and the Windows SDK, laid out by xwin for clang-cl's `/winsysroot`. */
export function windowsSysroot(image: LinuxImage, pin: { xwin: string; sdk: string; crt: string }): Tool {
  const host = `${image.arch === "x64" ? "x86_64" : "aarch64"}-unknown-linux-musl`;
  const url = `https://github.com/Jake-Shadle/xwin/releases/download/${pin.xwin}/xwin-${pin.xwin}-${host}.tar.gz`;
  return {
    name: "windows-sysroot",
    script: "linux/windows-sysroot.sh",
    variables: { XWIN_URL: url, WINDOWS_SDK_VERSION: pin.sdk, MSVC_CRT_VERSION: pin.crt },
    urls: [url],
  };
}
