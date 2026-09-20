import type { Tool } from "../image.ts";

/** x64 only. Served from Bun's own storage: Intel's download needs a login. */
export function intelSde(pin: { version: string; sha256: string }): Tool {
  const directory = `sde-external-${pin.version}-win`;
  const url = `https://buncistore.blob.core.windows.net/artifacts/${directory}.tar.xz`;
  return {
    name: "intel-sde",
    script: "windows/intel-sde.ps1",
    variables: { INTEL_SDE_URL: url, INTEL_SDE_DIRECTORY: directory, INTEL_SDE_SHA256: pin.sha256 },
    urls: [url],
  };
}
