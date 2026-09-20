import type { Tool, WindowsImage } from "../image.ts";

/** An SSH server, so a stuck Windows machine can be looked at. */
export function openssh(image: WindowsImage, pin: { version: string }, directory: string): Tool {
  const url = `https://github.com/PowerShell/Win32-OpenSSH/releases/download/${pin.version}/OpenSSH-${image.arch === "x64" ? "Win64" : "Arm64"}.zip`;
  return {
    name: "openssh",
    script: "windows/openssh.ps1",
    variables: { OPENSSH_DIR: directory, OPENSSH_URL: url },
    files: { "fetch-ssh-keys.ps1": "scripts/build/ci-images/tools/windows/fetch-ssh-keys.ps1" },
  };
}
