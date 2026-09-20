import type { Image, Tool } from "../image.ts";

/**
 * rustup and the toolchain Bun is built with, in a home every user can use.
 * `rust-toolchain.toml` has to say the same thing, because rustup reads it.
 */
export function rust(
  image: Image,
  pin: { rustup: string; channel: string; components: readonly string[]; targets: readonly string[] },
): Tool {
  const cpu = image.arch === "x64" ? "x86_64" : "aarch64";
  const host = image.os === "windows" ? `${cpu}-pc-windows-msvc` : `${cpu}-unknown-linux-${image.abi}`;
  const url = `https://static.rust-lang.org/rustup/archive/${pin.rustup}/${host}/rustup-init${image.os === "windows" ? ".exe" : ""}`;
  return {
    name: "rust",
    script: image.os === "windows" ? "windows/rust.ps1" : "linux/rust.sh",
    variables: {
      RUSTUP_INIT_URL: url,
      RUST_CHANNEL: pin.channel,
      RUST_COMPONENTS: pin.components.join(","),
      RUST_TARGETS: pin.targets.join(","),
    },
    urls: [url],
  };
}
