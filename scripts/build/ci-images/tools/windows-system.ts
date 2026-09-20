import type { Tool } from "../image.ts";

/** Windows settings that get in a CI machine's way: Defender's scanning, Smart App Control, background services, power saving. */
export function windowsSystem(pin: { disabledServices: readonly string[] }): Tool {
  return {
    name: "system",
    script: "windows/system.ps1",
    variables: { DISABLED_SERVICES: pin.disabledServices.join(" ") },
    urls: [],
  };
}

/** Only Windows Server can remove Defender. */
export function uninstallDefender(): Tool {
  return { name: "uninstall-defender", script: "windows/uninstall-defender.ps1", variables: {}, urls: [] };
}
