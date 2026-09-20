import type { Tool } from "../image.ts";

export function pdbAddr2line(pin: { version: string }): Tool {
  return {
    name: "pdb-addr2line",
    script: "windows/pdb-addr2line.ps1",
    variables: { PDB_ADDR2LINE_VERSION: pin.version },
    urls: [],
  };
}
