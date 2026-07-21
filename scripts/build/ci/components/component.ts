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
//   - change a component's CODE  → hashes do not move (recipe code is
//     outside the hash, by design — see spec.epoch);
//   - change a component's FACTS → the spec entry changed → its images
//     re-bake automatically.
//
// An image's spec entry lists its components IN INSTALL ORDER, so ordering
// is data. bootstrap.ts assembles the plan via components/registry.ts, which
// walk that list; resolveArtifacts() walks the same list to build the
// hashed download bundle. Bake and hash therefore share one input by
// construction.

import type { Download } from "../artifacts.ts";
import type { LinuxImage, WindowsImage } from "../types.ts";
import type { Host } from "../bootstrap/host.ts";
import type { Step } from "../bootstrap/runtime.ts";

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

/** One platform's half of a component. Omit the platform a thing has no
 * meaning on (age has no windows; intelSde has no linux). */
export type LinuxSupport = {
  /** The downloads this component needs on this image, keyed by artifact
   * name. Part of the hash; the steps read the same names back. */
  artifacts: (image: LinuxImage) => ArtifactBundle;
  /** The install steps, in order. */
  steps: (ctx: LinuxContext) => Step[];
};

export type WindowsSupport = {
  artifacts: (image: WindowsImage) => ArtifactBundle;
  steps: (ctx: WindowsContext) => Step[];
};

export type Component = {
  /** Stable identifier; images list components by name. */
  name: string;
  linux?: LinuxSupport;
  windows?: WindowsSupport;
};

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
