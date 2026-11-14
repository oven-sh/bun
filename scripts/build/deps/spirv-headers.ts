/**
 * SPIR-V headers — included by Tint's SPIR-V writer. The commit is the one in Dawn's DEPS (dawn.ts).
 */

import type { Dependency } from "../source.ts";
import { usesVulkan } from "./dawn.ts";

const SPIRV_HEADERS_COMMIT = "6efe5ae6b7c6ad29da3f2cc3f164b9c3d72b78b1";

export const spirvHeaders: Dependency = {
  name: "spirv-headers",

  source: () => ({
    kind: "github-archive",
    repo: "KhronosGroup/SPIRV-Headers",
    commit: SPIRV_HEADERS_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({ libs: [], includes: [] }),

  enabled: usesVulkan,
};
