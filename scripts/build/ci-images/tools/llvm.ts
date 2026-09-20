import type { Image, Tool } from "../image.ts";
import { brewPrefix } from "./brew.ts";

/**
 * clang, lld and the LLVM tools. Scoop installs the exact release on Windows.
 * Neither apt.llvm.org, Alpine nor Homebrew can be asked for a patch release,
 * only for a major; scripts/build/tools.ts is what decides whether the compiler it finds
 * is close enough to the pin.
 */
export function llvm(image: Image, pin: { version: string }): Tool {
  if (image.os === "windows") {
    return {
      name: "llvm",
      script: "windows/llvm.ps1",
      variables: { LLVM_VERSION: pin.version, LLVM_SCOOP_PACKAGE: image.arch === "x64" ? "llvm" : "llvm-arm64" },
    };
  }
  const variables = { LLVM_MAJOR: pin.version.split(".")[0]! };
  if (image.os === "darwin") {
    return { name: "llvm", script: "macos/llvm.sh", variables: { ...variables, BREW_PREFIX: brewPrefix(image) } };
  }
  if (image.distro === "alpine") {
    return { name: "llvm", script: "linux/llvm.apk.sh", variables };
  }
  const url = "https://apt.llvm.org/llvm.sh";
  return { name: "llvm", script: "linux/llvm.apt.sh", variables: { ...variables, LLVM_SH_URL: url } };
}
