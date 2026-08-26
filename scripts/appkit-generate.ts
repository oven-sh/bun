#!/usr/bin/env bun
// Everything bun:objc derives from the macOS SDK (the SDK's headers are
// preprocessed and parsed once per architecture and shared by every
// generator):
//
// - sdk.rs (scripts/appkit-sdk-methods.ts), cf.rs and appkit_enums.ts
//   (scripts/appkit-enums.ts): the tables the bridge reads at run time. The
//   build writes them into its codegen directory from the SDK it links
//   (`--out <dir> --sdk <path>`, see emitAppKitSdk in scripts/build/codegen.ts);
//   they are not committed.
// - packages/bun-types/objc-sdk.d.ts and objc-sdk-stubs.d.ts
//   (scripts/appkit-dts.ts): the opt-in typings, committed. They track the
//   SDK of the version the build pins (MACOS_SDK_VERSION in
//   scripts/build/macos-sdk.ts): the Xcode or Command Line Tools that carry
//   it, or MACOS_SDK_PATH pointing at it. Rerun when that pin moves. In CI
//   the test lane whose image carries the pinned SDK in /opt/macos-sdk (the
//   Linux build host's, see install_macos_sdk in scripts/bootstrap.sh) runs
//   `--check` from test/js/bun/appkit/appkit.test.ts; the macOS agents have
//   Xcode's SDK, not the pinned one, and skip it.
//
//   bun scripts/appkit-generate.ts                          # rewrite the typings
//   bun scripts/appkit-generate.ts --check                  # exit 1 if they are stale, 2 if there is no such SDK
//   bun scripts/appkit-generate.ts --out <dir> --sdk <path> # write the run-time tables into <dir> from the SDK at <path>

import { mkdirSync } from "node:fs";
import { main as dts } from "./appkit-dts";
import { main as enums } from "./appkit-enums";
import { sdk, useSdk } from "./appkit-sdk";
import { main as sdkMethods } from "./appkit-sdk-methods";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at >= 0) return process.argv[at + 1];
  return process.argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

const out = option("--out");
const explicitSdk = option("--sdk");
if (out !== undefined) {
  if (explicitSdk === undefined) throw new Error("--out needs --sdk <path>: the SDK the build links");
  useSdk(explicitSdk);
} else if (explicitSdk !== undefined) {
  throw new Error("--sdk is for --out; the typings read the pinned SDK");
}

const toolchain = sdk();
if (toolchain.sdk === null) {
  console.error(toolchain.reason);
  process.exit(2);
}
console.error(`macOS SDK ${toolchain.version} (${toolchain.sdk})`);
if (out !== undefined) {
  mkdirSync(out, { recursive: true });
  enums(out);
  sdkMethods(out);
} else {
  dts();
}
