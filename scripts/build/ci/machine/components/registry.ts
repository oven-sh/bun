// The component registry: name → component per platform, and the
// derivations that walk an image's component list.
//
// An image's spec entry lists its components BY NAME, IN INSTALL ORDER
// (ordering is data — python-fuse after build-essentials is visible in the
// spec, not an accident of code position). This module resolves those names
// and derives from ONE list:
//
//   - the ordered install steps for that platform;
//   - the merged download bundle for that platform.
//
// Both derivations walk the same list, so what is baked is defined once. A
// name in the spec with no registered component is a loud error, not a skip.

import type { LinuxImage, WindowsImage } from "../../types.ts";
import type { Download } from "../artifacts.ts";
import type { Step } from "../runtime.ts";
import type { ArtifactBundle, LinuxComponent, LinuxContext, WindowsComponent, WindowsContext } from "./component.ts";
import { chrome, chromium } from "./linux/browsers.ts";
import { ciUser } from "./linux/ci-user.ts";
import {
  androidNdk,
  crossBinutils,
  freebsdSysroot,
  glibcSysroot,
  macosSdk,
  muslSysroot,
  windowsSysroot,
} from "./linux/cross.ts";
import { nodejs as linuxNodejs } from "./linux/nodejs.ts";
import { prefetch as linuxPrefetch } from "./linux/prefetch.ts";
import {
  age,
  buildkiteAgent as linuxBuildkiteAgent,
  bun as linuxBun,
  curlH3 as linuxCurlH3,
} from "./linux/runtimes.ts";
import { baseSystem, cleanup, coreDumps } from "./linux/system.ts";
import { cmake, docker, rust as linuxRust, llvm, pythonFuse, tailscale } from "./linux/toolchain.ts";
import { nodejs as windowsNodejs } from "./windows/nodejs.ts";
import { prefetch as windowsPrefetch } from "./windows/prefetch.ts";
import {
  buildkiteAgent as windowsBuildkiteAgent,
  bun as windowsBun,
  curlH3 as windowsCurlH3,
} from "./windows/runtimes.ts";
import { rust as windowsRust } from "./windows/rust.ts";
import { scoop } from "./windows/scoop.ts";
import { defenderRemoval, optimizeWindows } from "./windows/system.ts";
import { ccache, intelSde, openssh, pdbAddr2line, powershell, visualStudio } from "./windows/toolchain.ts";

const linuxRegistry = register([
  linuxNodejs,
  linuxBun,
  linuxCurlH3,
  linuxBuildkiteAgent,
  age,
  linuxPrefetch,
  ciUser,
  baseSystem,
  cmake,
  llvm,
  pythonFuse,
  linuxRust,
  docker,
  tailscale,
  chrome,
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
]);

const windowsRegistry = register([
  windowsNodejs,
  windowsBun,
  windowsCurlH3,
  windowsBuildkiteAgent,
  windowsPrefetch,
  optimizeWindows,
  scoop,
  powershell,
  openssh,
  ccache,
  pdbAddr2line,
  visualStudio,
  intelSde,
  windowsRust,
  defenderRemoval,
]);

function register<T extends { name: string }>(components: readonly T[]): Map<string, T> {
  const byName = new Map<string, T>();
  for (const component of components) {
    // Two components sharing a name would silently shadow each other.
    if (byName.has(component.name)) throw new Error(`two components are named "${component.name}"`);
    byName.set(component.name, component);
  }
  return byName;
}

function resolve<T>(byName: Map<string, T>, os: string, imageKey: string, names: readonly string[]): T[] {
  return names.map(name => {
    const component = byName.get(name);
    if (!component) {
      throw new Error(
        `image "${imageKey}" lists ${os} component "${name}" but none is registered.\n` +
          `Registered: ${[...byName.keys()].join(", ")}`,
      );
    }
    return component;
  });
}

/** An image's ordered component objects, resolved from its name list. */
export function linuxComponents(image: LinuxImage): LinuxComponent[] {
  return resolve(linuxRegistry, "linux", image.key, image.components);
}

export function windowsComponents(image: WindowsImage): WindowsComponent[] {
  return resolve(windowsRegistry, "windows", image.key, image.components);
}

/** The ordered install steps for a linux image (the sequencer's input). */
export function linuxSteps(image: LinuxImage, ctx: LinuxContext): Step[] {
  return linuxComponents(image).flatMap(component => component.steps(ctx));
}

/** The ordered install steps for a windows image. */
export function windowsSteps(image: WindowsImage, ctx: WindowsContext): Step[] {
  return windowsComponents(image).flatMap(component => component.steps(ctx));
}

/** The merged download bundle for a linux image — one enumeration, walked
 * from the same list the steps come from. Duplicate names are a bug. */
export function linuxArtifacts(image: LinuxImage): ArtifactBundle {
  return mergeArtifacts(
    image.key,
    linuxComponents(image).map(component => ({ component: component.name, bundle: component.artifacts(image) })),
  );
}

export function windowsArtifacts(image: WindowsImage): ArtifactBundle {
  return mergeArtifacts(
    image.key,
    windowsComponents(image).map(component => ({ component: component.name, bundle: component.artifacts(image) })),
  );
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
