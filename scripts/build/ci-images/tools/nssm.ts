import type { Tool } from "../image.ts";

export function nssm(pin: { version: string }): Tool {
  const directory = `nssm-${pin.version}`;
  const url = `https://buncistore.blob.core.windows.net/artifacts/${directory}.zip`;
  return {
    name: "nssm",
    script: "windows/nssm.ps1",
    variables: { NSSM_URL: url, NSSM_DIRECTORY: directory },
  };
}
