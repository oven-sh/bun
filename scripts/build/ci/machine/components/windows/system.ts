// Windows base-system tuning for CI images: Defender realtime scanning off,
// telemetry/services stopped, high-performance power scheme; and — last,
// after everything that installs software — the Defender feature uninstall
// that only takes effect on reboot.

import * as win from "../../ops-windows.ts";
import type { WindowsComponent } from "../component.ts";

/** CI-only optimizations (Defender off, services disabled, high-perf
 * power). First on every windows CI image. */
export const optimizeWindows: WindowsComponent = {
  name: "optimize-windows",
  artifacts: () => ({}),
  steps: ctx => {
    const { image, ci } = ctx;
    return [
      {
        name: "Optimize Windows for CI (Defender off, telemetry/services off, high-perf power)",
        skip: !ci && "not a CI image",
        run: async () => {
          // Defender realtime scanning turns a 2-minute bun install into 20.
          await win.powershellScript({
            describe: "disable Defender realtime monitoring, exclude C:\\ and D:\\, force ATP passive mode",
            script: `Set-MpPreference -DisableRealtimeMonitoring $true
Add-MpPreference -ExclusionPath 'C:\\', 'D:\\'
$atp = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Advanced Threat Protection'
if (Test-Path $atp) { Set-ItemProperty -Path $atp -Name 'ForceDefenderPassiveMode' -Value 1 -Type DWORD }`,
          });
          for (const service of image.optimize.disabledServices) {
            await win.stopAndDisableService(service);
          }
          await win.powershellScript({
            describe: `activate the high-performance power scheme (${image.optimize.powerScheme}) and disable sleep/hibernate timeouts`,
            script: `powercfg /setactive ${image.optimize.powerScheme}
powercfg /change monitor-timeout-ac 0
powercfg /change monitor-timeout-dc 0
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0`,
          });
        },
      },
    ];
  },
};

/** Remove the Windows Defender feature outright (disabled by
 * optimize-windows; this uninstalls it). Takes effect on reboot, so it goes
 * at the end of a CI bake. */
export const defenderRemoval: WindowsComponent = {
  name: "defender-removal",
  artifacts: () => ({}),
  steps: ctx => {
    const { ci } = ctx;
    return [
      {
        name: "Uninstall Windows Defender feature (takes effect on reboot)",
        skip: !ci && "not a CI image",
        run: () =>
          win
            .powershellScript({
              describe: "Uninstall-WindowsFeature Windows-Defender (no-op on SKUs without the cmdlet)",
              allowFailure: true,
              script: `if (Get-Command Uninstall-WindowsFeature -ErrorAction SilentlyContinue) {
Uninstall-WindowsFeature -Name Windows-Defender
} else {
Write-Output "Uninstall-WindowsFeature unavailable on this SKU (Defender stays disabled, not removed)"
}`,
            })
            .then(() => undefined),
      },
    ];
  },
};
