import type { Image, Tool } from "../image.ts";

export function buildkiteAgent(image: Image, pin: { version: string }): Tool {
  const arch = image.arch === "x64" ? "amd64" : "arm64";
  const release = `https://github.com/buildkite/agent/releases/download/v${pin.version}`;
  const url =
    image.os === "windows"
      ? `${release}/buildkite-agent-windows-${arch}-${pin.version}.zip`
      : `${release}/buildkite-agent-linux-${arch}-${pin.version}.tar.gz`;
  return {
    name: "buildkite-agent",
    script: image.os === "windows" ? "windows/buildkite-agent.ps1" : "linux/buildkite-agent.sh",
    variables: { BUILDKITE_AGENT_URL: url },
  };
}
