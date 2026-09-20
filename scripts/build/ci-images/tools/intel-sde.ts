import type { Tool } from "../image.ts";

/** x64 only. Served from Bun's own storage: Intel's download needs a login. */
export function intelSde(pin: { version: string; sha256: string }, directory: string): Tool {
  const archiveRoot = `sde-external-${pin.version}-win`;
  const url = `https://buncistore.blob.core.windows.net/artifacts/${archiveRoot}.tar.xz`;
  return {
    name: "intel-sde",
    script: "windows/intel-sde.ps1",
    variables: {
      INTEL_SDE_DIR: directory,
      INTEL_SDE_URL: url,
      INTEL_SDE_ARCHIVE_ROOT: archiveRoot,
      INTEL_SDE_SHA256: pin.sha256,
    },
  };
}
