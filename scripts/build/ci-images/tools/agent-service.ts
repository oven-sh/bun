import type { Image, Tool } from "../image.ts";

/**
 * The service an image boots into: scripts/agent.ts, which the generator
 * copies into the bake directory, installs itself and registers the service.
 */
export function agentService(image: Image): Tool {
  return {
    name: "agent-service",
    script: image.os === "windows" ? "windows/agent-service.ps1" : "linux/agent-service.sh",
    variables: {},
    // .mts: an ES module whatever directory it is in.
    files: { "agent.mts": "scripts/agent.ts" },
  };
}
