import type { LinuxImage, Tool } from "../image.ts";

export function buildkiteAgent(image: LinuxImage, pin: { version: string }): Tool {
  const arch = image.arch === "x64" ? "amd64" : "arm64";
  const url = `https://github.com/buildkite/agent/releases/download/v${pin.version}/buildkite-agent-linux-${arch}-${pin.version}.tar.gz`;
  return {
    name: "buildkite-agent",
    script: "linux/buildkite-agent.sh",
    variables: { BUILDKITE_AGENT_URL: url, BUILDKITE_AGENT_VERSION: pin.version },
    urls: [url],
  };
}
