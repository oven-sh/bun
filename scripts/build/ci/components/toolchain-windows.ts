// Windows toolchain: PowerShell 7, the OpenSSH server, ccache, Rust (rustup)
// and the cargo-built pdb-addr2line, the Visual Studio Build Tools, and the
// x64-only Intel SDE. Each is a straight download → install against the
// image's root paths; the few installers with their own control flow use
// the powershellScript() escape hatch with a required description.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ccacheWindowsDownload,
  ccacheWindowsFolder,
  intelSdeDownload,
  opensshWindowsDownload,
  powershellDownload,
} from "../artifacts.ts";
import * as win from "../bootstrap/ops-windows.ts";
import { download, log, scratchDir, writeText } from "../bootstrap/runtime.ts";
import type { Component } from "./component.ts";
import { artifact } from "./component.ts";
import { windowsProgramFiles, windowsSystem32 } from "./paths.ts";

export const powershell: Component = {
  name: "powershell",
  windows: {
    artifacts: image => ({ powershell: powershellDownload(image.powershell, image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install PowerShell ${image.powershell.version}`,
          run: async () => {
            if (await win.commandOnPath("pwsh")) {
              log("pwsh already installed");
              return;
            }
            const msi = await download(artifact(ctx.artifacts, "powershell"), { name: "pwsh.msi" });
            await win.msiInstall({ path: msi, extraArgs: ["ADD_PATH=1"], validExitCodes: [0, 3010] });
          },
        },
      ];
    },
  },
};

/**
 * OpenSSH server for interactive debugging of live agents. sshd is set to
 * start on boot (not started now — host keys may not exist during the bake),
 * key auth only, and a boot task fetches oven-sh members' GitHub keys so any
 * bun dev can ssh in.
 */
export const openssh: Component = {
  name: "openssh",
  windows: {
    artifacts: image => ({ openssh: opensshWindowsDownload(image.openssh, image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install OpenSSH server ${image.openssh.version}`,
          run: async () => {
            if (await win.serviceExists("sshd")) {
              log("sshd already installed");
              return;
            }
            const zip = await download(artifact(ctx.artifacts, "openssh"), { name: "OpenSSH.zip" });
            const extract = join(scratchDir, "OpenSSH-extract");
            await win.extractArchive({ file: zip, into: extract });
            // Add-WindowsCapability needs DISM elevation unavailable in Packer's
            // WinRM session, so install from the release's own scripts — its control
            // flow (nested folder, install script, permissions fixup) is a script.
            await win.powershellScript({
              describe: "run OpenSSH's install-sshd.ps1 + FixHostFilePermissions, key auth only, default shell pwsh",
              script: `$dest = "$env:ProgramFiles\\OpenSSH"
New-Item -Path $dest -ItemType Directory -Force | Out-Null
$sub = Get-ChildItem -Path ${win.psq(extract)} -Directory | Select-Object -First 1
Get-ChildItem -Path $sub.FullName -Recurse | Move-Item -Destination $dest -Force
& "$dest\\install-sshd.ps1"
& "$dest\\FixHostFilePermissions.ps1" -Confirm:$false
Set-Service -Name sshd -StartupType Automatic
# Default shell: pwsh if present, else Windows PowerShell.
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue)
if (-not $shell) { $shell = (Get-Command powershell) }
New-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell -Value $shell.Path -PropertyType String -Force | Out-Null
$cfg = 'C:\\ProgramData\\ssh\\sshd_config'
if (Test-Path $cfg) {
  (Get-Content $cfg) -replace '#PubkeyAuthentication yes', 'PubkeyAuthentication yes' -replace 'PasswordAuthentication yes', 'PasswordAuthentication no' | Set-Content -Path $cfg
}
Write-Output "OpenSSH server installed and configured"`,
            });
            await win.allowInboundTcp({ ruleName: "OpenSSH-Server", displayName: "OpenSSH Server (sshd)", port: 22 });
            await win.removePaths(extract);
            // Startup task: fetch oven-sh GitHub org members' SSH keys on every boot.
            const fetchKeys = `try {
  $members = Invoke-RestMethod -Uri "https://api.github.com/orgs/oven-sh/members" -Headers @{ "User-Agent" = "bun-ci" }
  $keys = @()
  foreach ($member in $members) {
    if ($member.type -ne "User" -or -not $member.login) { continue }
    try {
      $userKeys = (Invoke-WebRequest -Uri "https://github.com/$($member.login).keys" -UseBasicParsing).Content
      if ($userKeys) { $keys += $userKeys.Trim() }
    } catch { }
  }
  if ($keys.Count -gt 0) {
    $keysPath = "C:\\ProgramData\\ssh\\administrators_authorized_keys"
    Set-Content -Path $keysPath -Value ($keys -join "\`n") -Force
    icacls $keysPath /inheritance:r /grant "SYSTEM:(F)" /grant "Administrators:(R)" | Out-Null
  }
} catch { }
`;
            await writeText("C:\\ProgramData\\ssh\\fetch-ssh-keys.ps1", fetchKeys);
            await win.registerStartupTask({
              name: "FetchSshKeys",
              scriptPath: "C:\\ProgramData\\ssh\\fetch-ssh-keys.ps1",
            });
          },
        },
      ];
    },
  },
};

export const ccache: Component = {
  name: "ccache",
  windows: {
    artifacts: image => ({ ccache: ccacheWindowsDownload(image.ccache, image.arch) }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install ccache ${image.ccache.version}`,
          run: async () => {
            if (await win.commandOnPath("ccache")) {
              log("ccache already installed");
              return;
            }
            const zip = await download(artifact(ctx.artifacts, "ccache"), { name: "ccache.zip" });
            const extract = join(scratchDir, "ccache-extract");
            await win.extractArchive({ file: zip, into: extract });
            const installDir = windowsProgramFiles(image, "ccache");
            await win.copyIntoDirectory(`${extract}\\${ccacheWindowsFolder(image.ccache, image.arch)}`, installDir);
            await win.addToMachinePath(installDir);
          },
        },
      ];
    },
  },
};

export const pdbAddr2line: Component = {
  name: "pdb-addr2line",
  windows: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: `Install pdb-addr2line ${image.pdbAddr2line.version} (via cargo)`,
          run: async () => {
            const cargoBin = `${image.rust.home}\\cargo\\bin`;
            await win.powershellScript({
              describe: `cargo install pdb-addr2line@${image.pdbAddr2line.version}`,
              script: `$env:CARGO_HOME = ${win.psq(`${image.rust.home}\\cargo`)}
$env:RUSTUP_HOME = ${win.psq(`${image.rust.home}\\rustup`)}
& ${win.psq(`${cargoBin}\\cargo.exe`)} install --examples ${win.psq(`pdb-addr2line@${image.pdbAddr2line.version}`)}
if ($LASTEXITCODE -ne 0) { throw "cargo install pdb-addr2line failed: $LASTEXITCODE" }`,
            });
            // Also in System32 so it's always on PATH (like bun.exe).
            await win.installFile({
              from: `${cargoBin}\\pdb-addr2line.exe`,
              to: windowsSystem32(image, "pdb-addr2line.exe"),
            });
          },
        },
      ];
    },
  },
};

export const visualStudio: Component = {
  name: "visual-studio",
  windows: {
    artifacts: image => ({ visualStudio: { url: image.visualStudio.bootstrapperUrl, sha256: null } }),
    steps: ctx => {
      const { image } = ctx;
      return [
        {
          name: "Install Visual Studio Build Tools (NativeDesktop workload)",
          run: async () => {
            const installer = await download(artifact(ctx.artifacts, "visualStudio"), { name: "vs_installer.exe" });
            // 3010 = success, reboot required.
            await win.exeInstall({
              path: installer,
              args: [
                "--passive",
                "--norestart",
                "--wait",
                "--force",
                "--locale en-US",
                ...image.visualStudio.workloadArgs,
              ],
              validExitCodes: [0, 3010],
            });
          },
        },
      ];
    },
  },
};

/** Intel SDE (baseline CPU emulator for verify-baseline). x64 only:
 * emulates a pre-AVX CPU; there is nothing to emulate on aarch64, so this
 * component has no meaning there. */
export const intelSde: Component = {
  name: "intel-sde",
  windows: {
    artifacts: image => {
      if (image.arch !== "x64") return {};
      return { intelSde: intelSdeDownload(image.intelSde) };
    },
    steps: ctx => {
      const { image } = ctx;
      if (image.arch !== "x64") return [];
      const sde = image.intelSde;
      return [
        {
          name: `Install Intel SDE ${sde.version} (baseline CPU emulator)`,
          run: async () => {
            if (existsSync(join(sde.installDir, "sde.exe"))) {
              log(`${sde.installDir}\\sde.exe already exists`);
              return;
            }
            const tarXz = await download(artifact(ctx.artifacts, "intelSde"), { name: "sde-external.tar.xz" });
            const extract = join(scratchDir, "sde-extract");
            await win.extractArchive({ file: tarXz, into: extract });
            // Keep the whole kit directory intact: sde.exe resolves its Pin
            // DLLs relative to its own location.
            await win.moveDirectory(`${extract}\\sde-external-${sde.version}-win`, sde.installDir);
            await win.removePaths(extract);
            await win.verify(`${sde.installDir}\\sde.exe is present`, () => {
              if (!existsSync(join(sde.installDir, "sde.exe"))) throw new Error("sde.exe not found after install");
            });
          },
        },
      ];
    },
  },
};
