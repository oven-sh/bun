import type { LinuxImage, Tool } from "../image.ts";

/** The account the Buildkite agent and every CI job run as, and the directories the agent uses. */
export function agentUser(image: LinuxImage): Tool {
  return {
    name: "agent-user",
    script: image.distro === "alpine" ? "linux/agent-user.busybox.sh" : "linux/agent-user.shadow.sh",
    variables: {},
    urls: [],
  };
}
