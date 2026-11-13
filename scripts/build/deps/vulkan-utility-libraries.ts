/**
 * Vulkan utility libraries — Dawn's Vulkan backend includes vk_struct_helper.hpp. The commit is the one in Dawn's
 * DEPS (dawn.ts).
 */

import type { Dependency } from "../source.ts";
import { usesVulkan } from "./dawn.ts";

const VULKAN_UTILITY_LIBRARIES_COMMIT = "5a873d3b75d38ef6a0833589ce3603d63f3f6a9c";

export const vulkanUtilityLibraries: Dependency = {
  name: "vulkan-utility-libraries",

  source: () => ({
    kind: "github-archive",
    repo: "KhronosGroup/Vulkan-Utility-Libraries",
    commit: VULKAN_UTILITY_LIBRARIES_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({ libs: [], includes: [] }),

  enabled: usesVulkan,
};
