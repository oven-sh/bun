import type { Tool } from "../image.ts";

export function visualStudio(pin: { channel: string }): Tool {
  const url = `https://aka.ms/vs/${pin.channel}/release/vs_community.exe`;
  return {
    name: "visual-studio",
    script: "windows/visual-studio.ps1",
    variables: { VISUAL_STUDIO_URL: url },
    urls: [url],
  };
}
