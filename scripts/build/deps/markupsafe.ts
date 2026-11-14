/**
 * MarkupSafe — imported by Jinja (jinja.ts). Runs at build time, nothing of it ships.
 */

import type { Dependency } from "../source.ts";

const MARKUPSAFE_COMMIT = "297fc8e356e6836a62087949245d09a28e9f1b13"; // 3.0.3

export const markupsafe: Dependency = {
  name: "markupsafe",

  source: () => ({
    kind: "github-archive",
    repo: "pallets/markupsafe",
    commit: MARKUPSAFE_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({ libs: [], includes: [] }),
};
