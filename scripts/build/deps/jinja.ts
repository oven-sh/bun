/**
 * Jinja — the template engine of Dawn's code generators (dawn.ts). Runs at build time, nothing of it ships.
 */

import type { Dependency } from "../source.ts";

const JINJA_COMMIT = "15206881c006c79667fe5154fe80c01c65410679"; // 3.1.6

export const jinja: Dependency = {
  name: "jinja",

  source: () => ({
    kind: "github-archive",
    repo: "pallets/jinja",
    commit: JINJA_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({ libs: [], includes: [] }),
};
