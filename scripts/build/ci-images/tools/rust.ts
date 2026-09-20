import type { Image, Tool } from "../image.ts";

function hostTriple(image: Image): string {
  const cpu = image.arch === "x64" ? "x86_64" : "aarch64";
  switch (image.os) {
    case "linux":
      return `${cpu}-unknown-linux-${image.abi}`;
    case "windows":
      return `${cpu}-pc-windows-msvc`;
    case "darwin":
      return `${cpu}-apple-darwin`;
  }
}

/**
 * rustup and the toolchain Bun is built with, in a home every user can use.
 * `rust-toolchain.toml` has to say the same thing, because rustup reads it.
 */
export function rust(
  image: Image,
  pin: { rustup: string; channel: string; components: readonly string[]; targets: readonly string[] },
  directory: Record<Image["os"], string>,
): Tool {
  const url = `https://static.rust-lang.org/rustup/archive/${pin.rustup}/${hostTriple(image)}/rustup-init${image.os === "windows" ? ".exe" : ""}`;
  return {
    name: "rust",
    script: { linux: "linux/rust.sh", windows: "windows/rust.ps1", darwin: "macos/rust.sh" }[image.os],
    variables: {
      RUST_DIR: directory[image.os],
      RUSTUP_INIT_URL: url,
      RUST_CHANNEL: pin.channel,
      RUST_COMPONENTS: pin.components.join(","),
      RUST_TARGETS: pin.targets.join(","),
    },
  };
}
