import type { Tool, WindowsImage } from "../image.ts";

/** PowerShell 7: the shell CI's Windows commands and the SSH server use. */
export function pwsh(image: WindowsImage, pin: { version: string }): Tool {
  const arch = image.arch === "x64" ? "x64" : "arm64";
  const url = `https://github.com/PowerShell/PowerShell/releases/download/v${pin.version}/PowerShell-${pin.version}-win-${arch}.msi`;
  return {
    name: "pwsh",
    script: "windows/pwsh.ps1",
    variables: { PWSH_URL: url },
  };
}
