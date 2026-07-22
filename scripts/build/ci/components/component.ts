// The component contract: everything baked onto a CI machine is a Component.
//
// One file per baked thing (nodejs, bun, ccache, the glibc sysroot, ...).
// A component owns HOW its thing is installed on each platform it supports,
// and it enumerates the artifacts (downloads) it needs. It owns no FACTS:
// versions, URLs' inputs, install dirs and cache paths are all read from
// the image's spec entry. That split is what keeps the invariant "spec.ts
// is the single hashed source of truth" true while every thing lives in
// its own file:
//
//   - change a component's CODE  → the recipe hash moves and the images
//     for that platform re-bake (their generated bootstraps change);
//   - change a component's FACTS → the spec entry changed → its images
//     re-bake automatically.
//
// An image's spec entry lists its components IN INSTALL ORDER, so ordering
// is data. The generated per-image entry imports exactly that list, and
// components/registry.ts derives both the steps and the download bundle from
// it — one input, so what is baked and what is generated agree by
// construction.

import type { Download } from "../artifacts.ts";
import type { Host } from "../bootstrap/host.ts";
import type { Step } from "../bootstrap/runtime.ts";
import type { LinuxImage, WindowsImage } from "../types.ts";
import type { PackageManager } from "./package-manager.ts";

/** What a linux component's steps get. */
export type LinuxContext = {
  image: LinuxImage;
  host: Host;
  /** Baking a CI image (buildkite user, prefetch caches, tuning, cleanup).
   * False when provisioning a plain machine. */
  ci: boolean;
  /** Git ref cloned for the prefetch caches / xmac.mjs. */
  repoRef: string;
  /** Every download this image performs, keyed by artifact name — the same
   * bundle the image hash covers. Components read their downloads here. */
  artifacts: ArtifactBundle;
  /** This image's package manager. Resolved from the entry in the generated
   * per-image bundle, so only its own manager's code is present. */
  manager: PackageManager;
};

/** What a windows component's steps get. */
export type WindowsContext = {
  image: WindowsImage;
  host: Host;
  ci: boolean;
  repoRef: string;
  artifacts: ArtifactBundle;
};

/** Downloads keyed by a stable artifact name (unique across an image). */
export type ArtifactBundle = { readonly [artifactName: string]: Download };

/** A component for one platform. A thing that installs on both (nodejs,
 * rust, ...) is two components sharing a name in separate modules
 * (<name>.linux.ts / <name>.windows.ts), so a generated bootstrap imports
 * only its own platform's module and never carries the other's code. */
export type LinuxComponent = {
  /** Stable identifier; images list components by name. */
  name: string;
  /** The downloads this component needs on this image, keyed by artifact
   * name. The steps read the same names back. */
  artifacts: (image: LinuxImage) => ArtifactBundle;
  /** The install steps, in order. */
  steps: (ctx: LinuxContext) => Step[];
};

export type WindowsComponent = {
  name: string;
  artifacts: (image: WindowsImage) => ArtifactBundle;
  steps: (ctx: WindowsContext) => Step[];
};

export type Component = LinuxComponent | WindowsComponent;

/**
 * Read a download a component declared. A missing name is a genuine bug —
 * the component's steps referenced an artifact its own artifacts() never
 * produced — so it fails loudly, naming the artifact, instead of surfacing
 * as an undefined URL at download time.
 */
export function artifact(bundle: ArtifactBundle, name: string): Download {
  const found = bundle[name];
  if (!found) {
    throw new Error(
      `artifact "${name}" was not declared for this image; ` +
        `the component that downloads it must return it from artifacts()`,
    );
  }
  return found;
}
