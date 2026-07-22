// The whole fleet: every image entry, assembled from the per-platform
// specs. Consumers that need all images (the generator, naming, existence)
// import from here; spec.ts holds only the facts they share.

import { linuxBuildHost, linuxTestImages } from "./spec.linux.ts";
import { windowsImages } from "./spec.windows.ts";
import type { Image, LinuxBuildHostImage } from "./types.ts";

export const images: readonly Image[] = [linuxBuildHost, ...linuxTestImages, ...windowsImages];

/** The single build-host image, for consumers that need only it
 * (winsysroot.ts, macos-sdk.ts read its cross toolchains). */
export const buildHost: LinuxBuildHostImage = linuxBuildHost;
