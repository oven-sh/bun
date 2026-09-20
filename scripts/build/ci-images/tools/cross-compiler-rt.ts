import type { Tool } from "../image.ts";

/** amd64 compiler-rt on the arm64 build image, for the x64 ASAN cross-compile. */
export function crossCompilerRt(llvmPin: { version: string }): Tool {
  return {
    name: "cross-compiler-rt",
    script: "linux/cross-compiler-rt.sh",
    variables: { LLVM_MAJOR: llvmPin.version.split(".")[0]! },
    urls: [],
  };
}
