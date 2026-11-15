/**
 * Vulkan headers — included by Dawn's Vulkan backend, which loads libvulkan at run time. The commit is the one in
 * Dawn's DEPS (dawn.ts).
 */

import type { Dependency } from "../source.ts";
import { usesVulkan } from "./dawn.ts";

const VULKAN_HEADERS_COMMIT = "88487f687f3100ebe1d3559a8a34d971ee85b977";

export const vulkanHeaders: Dependency = {
  name: "vulkan-headers",

  source: () => ({
    kind: "github-archive",
    repo: "KhronosGroup/Vulkan-Headers",
    commit: VULKAN_HEADERS_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({ libs: [], includes: [] }),

  enabled: usesVulkan,
};
