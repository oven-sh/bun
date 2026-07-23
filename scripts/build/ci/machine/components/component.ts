// The component contract: everything baked onto a CI machine is a Component.
//
// One file per baked thing (nodejs, bun, ccache, the glibc sysroot, ...).
// A component owns HOW its thing is installed on each platform it supports,
// and it enumerates the artifacts (downloads) it needs. It owns no FACTS:
// versions, URLs' inputs, install dirs and cache paths are all read from
// the image's spec entry. That split is what keeps the invariant "the
// spec is the single hashed source of truth" true while every thing
// lives in its own file:
//
//   - change a component's FACTS → the spec entry changed → its images
//     re-bake automatically;
//   - change a component's CODE  → no image name moves (only spec values
//     are hashed); to ship a code-only fix, change a value in the affected
//     entry so the name is different.
//
// An image's spec entry lists its components IN INSTALL ORDER, so ordering
// is data. bootstrap.ts resolves that list by name through
// components/registry.ts, which derives both the steps and the download
// bundle from it — one input, so what is planned and what is fetched agree
// by construction.

import type { LinuxImage, WindowsImage } from "../../types.ts";
import type { Download } from "../artifacts.ts";
import type { Host } from "../host.ts";
import type { Step } from "../runtime.ts";
import type { PackageManager } from "./linux/package-manager.ts";

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
  /** This image's package manager, selected from the entry's
   * `packages.manager` fact by managerFor(). */
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
 * (linux/<name>.ts and windows/<name>.ts), each registered under its own
 * platform in components/registry.ts. */
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
