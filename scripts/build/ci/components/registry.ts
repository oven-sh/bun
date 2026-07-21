// The component registry: name → Component, and the two derivations that
// walk an image's component list.
//
// An image's spec entry lists its components BY NAME, IN INSTALL ORDER
// (ordering is data — python-fuse after build-essentials is visible in the
// spec, not an accident of code position). This module resolves those names
// and derives from ONE list:
//
//   - steps(image, ctx): the ordered install steps for that platform;
//   - artifacts(image):  the merged download bundle for that platform.
//
// Because both derivations walk the same list, what is baked and what is
// hashed are the same object by construction — the invariant the whole
// system rests on. A name in the spec with no registered component, or a
// component with no half for the image's OS, is a loud error, not a skip.

import type { Download } from "../artifacts.ts";
import type { LinuxImage, WindowsImage } from "../types.ts";
import type { Step } from "../bootstrap/runtime.ts";
import { chromium } from "./browsers-linux.ts";
import { ciUser } from "./ci-user.ts";
import type { ArtifactBundle, Component, LinuxContext, WindowsContext } from "./component.ts";
import { androidNdk, crossBinutils, freebsdSysroot, glibcSysroot, macosSdk, muslSysroot, windowsSysroot } from "./cross-linux.ts";
import { nodejs } from "./nodejs.ts";
import { prefetch } from "./prefetch.ts";
import { age, buildkiteAgent, bun, curlH3 } from "./runtimes.ts";
import { scoop } from "./scoop.ts";
import { baseSystem, cleanup, coreDumps } from "./system-linux.ts";
import { defenderRemoval, optimizeWindows } from "./system-windows.ts";
import { cmake, docker, llvm, pythonFuse, rust, tailscale } from "./toolchain-linux.ts";
import { ccache, intelSde, openssh, pdbAddr2line, powershell, visualStudio } from "./toolchain-windows.ts";

const all: readonly Component[] = [
  // shared
  nodejs,
  bun,
  curlH3,
  buildkiteAgent,
  age,
  prefetch,
  ciUser,
  // linux
  baseSystem,
  cmake,
  llvm,
  pythonFuse,
  rust,
  docker,
  tailscale,
  chromium,
  coreDumps,
  cleanup,
  crossBinutils,
  androidNdk,
  freebsdSysroot,
  glibcSysroot,
  muslSysroot,
  windowsSysroot,
  macosSdk,
  // windows
  optimizeWindows,
  scoop,
  powershell,
  openssh,
  ccache,
  pdbAddr2line,
  visualStudio,
  intelSde,
  defenderRemoval,
];

const byName = new Map<string, Component>();
for (const component of all) {
  // rust is ONE component with a linux and a windows half — two components
  // sharing a name would silently shadow each other, so refuse to load.
  if (byName.has(component.name)) {
    throw new Error(`two registered components are named "${component.name}"; merge them into one Component`);
  }
  byName.set(component.name, component);
}

/** Resolve a component by name, loudly. */
export function component(name: string): Component {
  const found = byName.get(name);
  if (!found) {
    throw new Error(
      `spec lists component "${name}" but no component with that name is registered.\n` +
        `Registered: ${[...byName.keys()].join(", ")}\n` +
        `Add it to components/registry.ts (or fix the spec entry).`,
    );
  }
  return found;
}

/** The ordered install steps for a linux image (the sequencer's input). */
export function linuxSteps(image: LinuxImage, ctx: LinuxContext): Step[] {
  return image.components.flatMap(name => {
    const support = component(name).linux;
    if (!support) throw new Error(`component "${name}" has no linux half but "${image.key}" lists it`);
    return support.steps(ctx);
  });
}

/** The ordered install steps for a windows image. */
export function windowsSteps(image: WindowsImage, ctx: WindowsContext): Step[] {
  return image.components.flatMap(name => {
    const support = component(name).windows;
    if (!support) throw new Error(`component "${name}" has no windows half but "${image.key}" lists it`);
    return support.steps(ctx);
  });
}

/** The merged download bundle for a linux image — one enumeration, walked
 * from the same list the steps come from. Duplicate names are a bug. */
export function linuxArtifacts(image: LinuxImage): ArtifactBundle {
  return mergeArtifacts(
    image.key,
    image.components.map(name => {
      const support = component(name).linux;
      if (!support) throw new Error(`component "${name}" has no linux half but "${image.key}" lists it`);
      return { component: name, bundle: support.artifacts(image) };
    }),
  );
}

export function windowsArtifacts(image: WindowsImage): ArtifactBundle {
  return mergeArtifacts(
    image.key,
    image.components.map(name => {
      const support = component(name).windows;
      if (!support) throw new Error(`component "${name}" has no windows half but "${image.key}" lists it`);
      return { component: name, bundle: support.artifacts(image) };
    }),
  );
}

/** The bundle for any image entry (naming.ts hashes this). */
export function resolveArtifacts(image: LinuxImage | WindowsImage): ArtifactBundle {
  return image.os === "linux" ? linuxArtifacts(image) : windowsArtifacts(image);
}

function mergeArtifacts(
  imageKey: string,
  parts: readonly { component: string; bundle: ArtifactBundle }[],
): ArtifactBundle {
  const merged: Record<string, Download> = {};
  const owner: Record<string, string> = {};
  for (const { component: name, bundle } of parts) {
    for (const [artifactName, download] of Object.entries(bundle)) {
      const previous = owner[artifactName];
      if (previous !== undefined) {
        throw new Error(
          `artifact name "${artifactName}" is declared by both "${previous}" and "${name}" on "${imageKey}"; ` +
            `artifact names must be unique across an image`,
        );
      }
      owner[artifactName] = name;
      merged[artifactName] = download;
    }
  }
  return merged;
}
