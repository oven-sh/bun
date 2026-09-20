import type { Tool } from "../image.ts";

/** The Android NDK's sysroot and runtimes; Bun's own clang does the compiling. */
export function androidNdk(pin: { version: string; apiLevel: number }, directory: string): Tool {
  const url = `https://dl.google.com/android/repository/android-ndk-${pin.version}-linux.zip`;
  return {
    name: "android-ndk",
    script: "linux/android-ndk.sh",
    variables: {
      ANDROID_NDK_DIR: directory,
      ANDROID_NDK_URL: url,
      ANDROID_NDK_VERSION: pin.version,
      ANDROID_API_LEVEL: String(pin.apiLevel),
    },
  };
}
