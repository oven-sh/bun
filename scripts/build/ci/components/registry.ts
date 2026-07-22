// Derivations over an image's resolved component list.
//
// An image's spec entry lists its components BY NAME, IN INSTALL ORDER
// (ordering is data — python-fuse after build-essentials is visible in the
// spec, not an accident of code position). The generated per-image entry
// (generate.ts) imports exactly those components — for that image's OS —
// and passes them here as an ordered list, so a bundle carries only its own
// image's, own platform's code.
//
// Both derivations walk the same list, so what is baked and what is
// generated agree by construction.

import type { Download } from "../artifacts.ts";
import type { Step } from "../bootstrap/runtime.ts";
import type { LinuxImage, WindowsImage } from "../types.ts";
import type { ArtifactBundle, LinuxComponent, LinuxContext, WindowsComponent, WindowsContext } from "./component.ts";

/** The ordered install steps for a linux image (the sequencer's input). */
export function linuxSteps(components: readonly LinuxComponent[], ctx: LinuxContext): Step[] {
  return components.flatMap(component => component.steps(ctx));
}

/** The ordered install steps for a windows image. */
export function windowsSteps(components: readonly WindowsComponent[], ctx: WindowsContext): Step[] {
  return components.flatMap(component => component.steps(ctx));
}

/** The merged download bundle for a linux image — one enumeration, walked
 * from the same list the steps come from. Duplicate names are a bug. */
export function linuxArtifacts(components: readonly LinuxComponent[], image: LinuxImage): ArtifactBundle {
  return mergeArtifacts(
    image.key,
    components.map(component => ({ component: component.name, bundle: component.artifacts(image) })),
  );
}

/** The merged download bundle for a windows image. */
export function windowsArtifacts(components: readonly WindowsComponent[], image: WindowsImage): ArtifactBundle {
  return mergeArtifacts(
    image.key,
    components.map(component => ({ component: component.name, bundle: component.artifacts(image) })),
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
