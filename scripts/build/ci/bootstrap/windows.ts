// Windows image bootstrap: the steps that turn a fresh Windows VM into a
// Bun CI image, driven entirely by a WindowsImage entry from spec.ts.
//
// Steps are recipes over the ops vocabulary in ./ops-windows.ts — they
// say what to do; the ops decide how (PowerShell, quoting, elevation is
// already SYSTEM inside the Packer provisioner). Every fact is read from
// the image entry; none is declared here. The few genuine scripts
// (Scoop's self-installer, OpenSSH's install script, an installer with
// its own control flow) use ops.powershellScript() with a required
// description, so they read as labeled exceptions.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WindowsArtifacts } from "../artifacts.ts";
import { ccacheWindowsFolder } from "../artifacts.ts";
import type { WindowsImage } from "../types.ts";
import type { Host } from "./host.ts";
import {
  addToMachinePath,
  allowInboundTcp,
  commandOnPath,
  copyIntoDirectory,
  ensureDirectory,
  exeInstall,
  extractArchive,
  findFile,
  installFile,
  makeReadOnlyRecursive,
  moveDirectory,
  msiInstall,
  powershellScript,
  registerStartupTask,
  removePaths,
  removeTreeRobustly,
  serviceExists,
  setMachineEnv,
  setRegistryValue,
  setServiceStartup,
  stopAndDisableService,
  verify,
} from "./ops-windows.ts";
import type { Step } from "./runtime.ts";
import { download, log, mode, run, runOutput, scratchDir, warn, writeText } from "./runtime.ts";

/** Context every windows step needs. */
export type WindowsContext = {
  image: WindowsImage;
  host: Host;
  ci: boolean;
  repoRef: string;
  /** The resolved download bundle for this image — the same object the
   * image hash covers, so what is fetched and what is hashed can't diverge. */
  artifacts: WindowsArtifacts;
};

const SYSTEM32 = "C:\\Windows\\System32";

export function windowsSteps(ctx: WindowsContext): Step[] {
  const { image, ci } = ctx;
  return [
    verifyHostStep(ctx),
    {
      name: "Optimize Windows for CI (Defender off, telemetry/services off, high-perf power)",
      skip: !ci && "not a CI image",
      run: async () => {
        // Defender realtime scanning turns a 2-minute bun install into 20.
        await powershellScript({
          describe: "disable Defender realtime monitoring, exclude C:\\ and D:\\, force ATP passive mode",
          script: `Set-MpPreference -DisableRealtimeMonitoring $true
Add-MpPreference -ExclusionPath 'C:\\', 'D:\\'
$atp = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Advanced Threat Protection'
if (Test-Path $atp) { Set-ItemProperty -Path $atp -Name 'ForceDefenderPassiveMode' -Value 1 -Type DWORD }`,
        });
        for (const service of image.optimize.disabledServices) {
          await stopAndDisableService(service);
        }
        await powershellScript({
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
    scoopSteps(ctx),
    scoopPackagesStep(ctx),
    nodejsHeadersStep(ctx),
    {
      name: `Install PowerShell ${image.powershell.version}`,
      run: async () => {
        if (await commandOnPath("pwsh")) {
          log("pwsh already installed");
          return;
        }
        const msi = await download(ctx.artifacts.powershell, { name: "pwsh.msi" });
        await msiInstall({ path: msi, extraArgs: ["ADD_PATH=1"], validExitCodes: [0, 3010] });
      },
    },
    {
      name: `Install OpenSSH server ${image.openssh.version}`,
      run: () => installOpenSsh(ctx),
    },
    {
      name: `Install Bun ${image.bun.version}`,
      run: async () => {
        const zip = await download(ctx.artifacts.bun, { name: "bun.zip" });
        const extract = join(scratchDir, "bun-extract");
        await extractArchive({ file: zip, into: extract });
        // System32 so it survives Sysprep (user-profile PATH is lost).
        const exe = await findFile(extract, "bun.exe");
        if (!exe) throw new Error(`bun.exe not found in ${zip}`);
        await installFile({ from: exe, to: `${SYSTEM32}\\bun.exe` });
        await verify("bun.exe --version runs", () => run([`${SYSTEM32}\\bun.exe`, "--version"]).then(() => undefined));
      },
    },
    {
      name: `Install curl-h3 ${image.curlH3.version} (HTTP/3 test client)`,
      run: async () => {
        // The bundled System32 curl.exe has no HTTP/3. Tests find this one
        // via $env:CURL_HTTP3, then `curl-h3` in PATH.
        const tar = await download(ctx.artifacts.curlH3, { name: "curl-h3.tar.xz" });
        const extract = join(scratchDir, "curl-h3");
        await extractArchive({ file: tar, into: extract });
        await installFile({ from: `${extract}\\curl.exe`, to: `${SYSTEM32}\\curl-h3.exe` });
        await installFile({ from: `${extract}\\curl-ca-bundle.crt`, to: `${SYSTEM32}\\curl-ca-bundle.crt` });
        await setMachineEnv("CURL_HTTP3", `${SYSTEM32}\\curl-h3.exe`);
        await verify("curl-h3 --version runs", () => run([`${SYSTEM32}\\curl-h3.exe`, "--version"]).then(() => undefined));
      },
    },
    {
      name: `Install ccache ${image.ccache.version}`,
      run: async () => {
        if (await commandOnPath("ccache")) {
          log("ccache already installed");
          return;
        }
        const zip = await download(ctx.artifacts.ccache, { name: "ccache.zip" });
        const extract = join(scratchDir, "ccache-extract");
        await extractArchive({ file: zip, into: extract });
        const installDir = "C:\\Program Files\\ccache";
        await copyIntoDirectory(`${extract}\\${ccacheWindowsFolder(image.ccache, image.arch)}`, installDir);
        await addToMachinePath(installDir);
      },
    },
    {
      name: "Install Rust (rustup)",
      run: async () => {
        if (await commandOnPath("rustc")) {
          log("rustc already installed");
          return;
        }
        const home = image.rust.home;
        await ensureDirectory(home);
        const init = await download(ctx.artifacts.rustupInit, { name: "rustup-init.exe" });
        // Install paths must be set in the SAME process that runs rustup so
        // it installs directly under Program Files (not SYSTEM's profile).
        await powershellScript({
          describe: `run rustup-init with CARGO_HOME/RUSTUP_HOME under ${home}`,
          script: `$env:CARGO_HOME = ${quote(`${home}\\cargo`)}
$env:RUSTUP_HOME = ${quote(`${home}\\rustup`)}
& ${quote(init)} -y
if ($LASTEXITCODE -ne 0) { throw "rustup-init failed: $LASTEXITCODE" }`,
        });
        await setMachineEnv("CARGO_HOME", `${home}\\cargo`);
        await setMachineEnv("RUSTUP_HOME", `${home}\\rustup`);
        await addToMachinePath(`${home}\\cargo\\bin`);
        await verify("rustc --version runs", () => run([`${home}\\cargo\\bin\\rustc.exe`, "--version"]).then(() => undefined));
      },
    },
    {
      name: `Install pdb-addr2line ${image.pdbAddr2line.version} (via cargo)`,
      run: async () => {
        const cargoBin = `${image.rust.home}\\cargo\\bin`;
        await powershellScript({
          describe: `cargo install pdb-addr2line@${image.pdbAddr2line.version}`,
          script: `$env:CARGO_HOME = ${quote(`${image.rust.home}\\cargo`)}
$env:RUSTUP_HOME = ${quote(`${image.rust.home}\\rustup`)}
& ${quote(`${cargoBin}\\cargo.exe`)} install --examples ${quote(`pdb-addr2line@${image.pdbAddr2line.version}`)}
if ($LASTEXITCODE -ne 0) { throw "cargo install pdb-addr2line failed: $LASTEXITCODE" }`,
        });
        // Also in System32 so it's always on PATH (like bun.exe).
        await installFile({ from: `${cargoBin}\\pdb-addr2line.exe`, to: `${SYSTEM32}\\pdb-addr2line.exe` });
      },
    },
    {
      name: "Install Visual Studio Build Tools (NativeDesktop workload)",
      run: async () => {
        const installer = await download(ctx.artifacts.visualStudio, { name: "vs_installer.exe" });
        // 3010 = success, reboot required.
        await exeInstall({
          path: installer,
          args: ["--passive", "--norestart", "--wait", "--force", "--locale en-US", ...image.visualStudio.workloadArgs],
          validExitCodes: [0, 3010],
        });
      },
    },
    intelSdeStep(ctx),
    ...ciSteps(ctx),
  ];
}

/** A PowerShell single-quoted literal (kept local to steps' composed
 * scripts; the ops module has its own). */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Individual step groups
// ---------------------------------------------------------------------------

function verifyHostStep(ctx: WindowsContext): Step {
  const { image, host } = ctx;
  return {
    name: "Verify host matches the spec image entry",
    run: () => {
      const problems: string[] = [];
      if (host.os !== "windows") problems.push(`os: host=${host.os} spec=windows`);
      if (host.arch !== image.arch) problems.push(`arch: host=${host.arch} spec=${image.arch}`);
      if (problems.length) {
        const message =
          `This machine does not match image "${image.key}":\n  - ${problems.join("\n  - ")}\n` +
          `Refusing to bake: bootstrap was pointed at the wrong image entry or launched on the wrong base image.`;
        if (!mode.dryRun) throw new Error(message);
        // Dry-run reviews the plan from any machine; report and continue.
        warn(`${message}\n(dry-run: continuing to print the plan anyway)`);
        return;
      }
      log(`Host matches spec image "${image.key}".`);
    },
  };
}

function scoopSteps(ctx: WindowsContext): Step {
  const { image } = ctx;
  return {
    name: "Install Scoop package manager",
    run: async () => {
      if (await commandOnPath("scoop")) {
        log("scoop already installed");
        return;
      }
      // Scoop blocks admin installs unless -RunAsAdmin; a known global
      // location so all users (incl. the agent service) see it. Its
      // installer is fetched and invoked by its own protocol — a script.
      await powershellScript({
        describe: `install Scoop into ${image.scoop.root} via its self-installer (${ctx.artifacts.scoopInstaller.url})`,
        script: `$env:SCOOP = ${quote(image.scoop.root)}
[Environment]::SetEnvironmentVariable('SCOOP', $env:SCOOP, 'Machine')
iex "& {$(irm ${ctx.artifacts.scoopInstaller.url})} -RunAsAdmin -ScoopDir ${image.scoop.root}"
scoop --version`,
      });
      await addToMachinePath(`${image.scoop.root}\\shims`);
    },
  };
}

function scoopPackagesStep(ctx: WindowsContext): Step {
  const { image, ci } = ctx;
  return {
    name: `Install Scoop packages (${image.scoop.packages.length})`,
    run: async () => {
      for (const pkg of image.scoop.packages) {
        if (await commandOnPath(pkg.command)) {
          log(`${pkg.name}: "${pkg.command}" already on PATH; skipping`);
          continue;
        }
        // post_install scripts can emit non-fatal errors (7zip ARM64
        // 7zr.exe locked, llvm-arm64 missing Uninstall.exe); don't let the
        // error stream fail the step — the PATH verification below catches
        // a genuinely failed install.
        await powershellScript({
          describe: `scoop install ${pkg.name}`,
          allowFailure: true,
          script: `$env:Path = ${quote(`${image.scoop.root}\\shims`)} + ';' + $env:Path
$prev = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
scoop install ${pkg.name} *>&1 | ForEach-Object { "$_" } | Write-Host
$ErrorActionPreference = $prev`,
        });
      }
      // Git for Windows ships Unix tools (cat, head, tail, ...) in usr\bin;
      // Cygwin binaries live at <scoop>\apps\cygwin\current\root\bin.
      for (const dir of [
        `${image.scoop.root}\\apps\\git\\current\\usr\\bin`,
        `${image.scoop.root}\\apps\\cygwin\\current\\root\\bin`,
      ]) {
        if (existsSync(dir) || mode.dryRun) await addToMachinePath(dir);
      }
      if (ci) {
        await powershellScript({
          describe: "system-wide git config for CI (safe.directory *, lf, longpaths)",
          script: `git config --system --add safe.directory "*"
git config --system core.autocrlf false
git config --system core.eol lf
git config --system core.longpaths true`,
        });
      }
      await verify("git, node, cmake, ninja, clang-cl, 7z, nssm are on PATH", async () => {
        for (const command of ["git", "node", "cmake", "ninja", "clang-cl", "7z", "nssm"]) {
          const path = await commandOnPath(command);
          if (!path) throw new Error(`After Scoop installs, "${command}" is not on PATH`);
          log(`${command}: ${path}`);
        }
      });
    },
  };
}

function nodejsHeadersStep(ctx: WindowsContext): Step {
  const { image } = ctx;
  return {
    name: `Verify Node.js is ${image.nodejs.version} and seed node-gyp headers`,
    run: async () => {
      await verify(`${image.paths.node} --version prints v${image.nodejs.version}`, async () => {
        const version = await runOutput([image.paths.node, "--version"]);
        if (version !== `v${image.nodejs.version}`) {
          throw new Error(`Scoop installed node ${version}, spec pins v${image.nodejs.version}`);
        }
      });
      // Seed node-gyp's cache so napi tests don't re-download headers +
      // node.lib on every run. node-gyp on Windows looks under
      // %LOCALAPPDATA%\node-gyp\Cache\<ver>\; seed both SYSTEM's and the
      // buildkite-agent service account's LocalAppData.
      const headers = await download(ctx.artifacts.nodejsHeaders, { name: "node-headers.tar.gz" });
      const lib = await download(ctx.artifacts.nodejsWinLib, { name: "node.lib" });
      const stage = join(scratchDir, "node-headers");
      await extractArchive({ file: headers, into: stage, stripComponents: 1 });
      const libArch = image.arch === "aarch64" ? "arm64" : "x64";
      const v = image.nodejs.version;
      const localAppData = process.env.LOCALAPPDATA;
      const cacheBases = [`${image.paths.buildkiteHome}\\AppData\\Local`];
      if (localAppData) cacheBases.push(localAppData);
      for (const base of cacheBases) {
        const cache = `${base}\\node-gyp\\Cache\\${v}`;
        await ensureDirectory(`${cache}\\${libArch}`);
        await copyIntoDirectory(`${stage}\\include`, `${cache}\\include`);
        await installFile({ from: lib, to: `${cache}\\${libArch}\\node.lib` });
        await writeText(`${cache}\\installVersion`, `${image.nodejs.gypInstallVersion}\r\n`);
      }
      await removePaths(stage);
    },
  };
}

function intelSdeStep(ctx: WindowsContext): Step {
  const { image } = ctx;
  return {
    name: `Install Intel SDE ${image.arch === "x64" ? image.intelSde.version : ""} (baseline CPU emulator)`,
    skip: image.arch !== "x64" && "x64 only (emulates a pre-AVX CPU for verify-baseline)",
    run: async () => {
      if (image.arch !== "x64") return;
      const sde = image.intelSde;
      if (existsSync(join(sde.installDir, "sde.exe"))) {
        log(`${sde.installDir}\\sde.exe already exists`);
        return;
      }
      const tarXz = await download(ctx.artifacts.intelSde!, { name: "sde-external.tar.xz" });
      const extract = join(scratchDir, "sde-extract");
      await extractArchive({ file: tarXz, into: extract });
      // Keep the whole kit directory intact: sde.exe resolves its Pin
      // DLLs relative to its own location.
      await moveDirectory(`${extract}\\sde-external-${sde.version}-win`, sde.installDir);
      await removePaths(extract);
      await verify(`${sde.installDir}\\sde.exe is present`, () => {
        if (!existsSync(join(sde.installDir, "sde.exe"))) throw new Error("sde.exe not found after install");
      });
    },
  };
}

/**
 * OpenSSH server for interactive debugging of live agents. sshd is set to
 * start on boot (not started now — host keys may not exist during the bake),
 * key auth only, and a boot task fetches oven-sh members' GitHub keys so any
 * bun dev can ssh in.
 */
async function installOpenSsh(ctx: WindowsContext): Promise<void> {
  const { image } = ctx;
  if (await serviceExists("sshd")) {
    log("sshd already installed");
    return;
  }
  const zip = await download(ctx.artifacts.openssh, { name: "OpenSSH.zip" });
  const extract = join(scratchDir, "OpenSSH-extract");
  await extractArchive({ file: zip, into: extract });
  // Add-WindowsCapability needs DISM elevation unavailable in Packer's
  // WinRM session, so install from the release's own scripts — its control
  // flow (nested folder, install script, permissions fixup) is a script.
  await powershellScript({
    describe: "run OpenSSH's install-sshd.ps1 + FixHostFilePermissions, key auth only, default shell pwsh",
    script: `$dest = "$env:ProgramFiles\\OpenSSH"
New-Item -Path $dest -ItemType Directory -Force | Out-Null
$sub = Get-ChildItem -Path ${quote(extract)} -Directory | Select-Object -First 1
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
  await allowInboundTcp({ ruleName: "OpenSSH-Server", displayName: "OpenSSH Server (sshd)", port: 22 });
  await removePaths(extract);
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
  await registerStartupTask({ name: "FetchSshKeys", scriptPath: "C:\\ProgramData\\ssh\\fetch-ssh-keys.ps1" });
}

// ---------------------------------------------------------------------------
// CI image state (agent, caches, defender removal)
// ---------------------------------------------------------------------------

function ciSteps(ctx: WindowsContext): Step[] {
  const { image, ci } = ctx;
  return [
    {
      name: `Install buildkite-agent ${image.buildkiteAgent.version}`,
      skip: !ci && "not a CI image",
      run: async () => {
        const zip = await download(ctx.artifacts.buildkiteAgent, { name: "buildkite-agent.zip" });
        const home = image.paths.buildkiteHome;
        await extractArchive({ file: zip, into: `${home}\\bin` });
        await addToMachinePath(`${home}\\bin`);
        await verify("buildkite-agent --version runs", () => run([`${home}\\bin\\buildkite-agent.exe`, "--version"]).then(() => undefined));
        // Environment hook: stable checkout path so ccache is effective.
        // pre-exit hook: log out of Tailscale so ephemeral nodes leave the
        // tailnet immediately instead of after a 30-60 min timeout.
        await writeText(
          `${home}\\hooks\\environment.ps1`,
          `# Buildkite environment hook (generated by scripts/build/ci/bootstrap)\r\n$env:BUILDKITE_BUILD_CHECKOUT_PATH = "${home}\\build"\r\n`,
        );
        await writeText(
          `${home}\\hooks\\pre-exit.ps1`,
          `if (Test-Path "C:\\Program Files\\Tailscale\\tailscale.exe") {\r\n  & "C:\\Program Files\\Tailscale\\tailscale.exe" logout 2>$null\r\n}\r\n`,
        );
      },
    },
    {
      name: "Warm the build prefetch cache and bun install cache",
      skip: !ci && "not a CI image",
      run: () => prefetchBuildDeps(ctx),
    },
    {
      name: "Uninstall Windows Defender feature (takes effect on reboot)",
      skip: !ci && "not a CI image",
      run: () =>
        powershellScript({
          describe: "Uninstall-WindowsFeature Windows-Defender (no-op on SKUs without the cmdlet)",
          allowFailure: true,
          script: `if (Get-Command Uninstall-WindowsFeature -ErrorAction SilentlyContinue) {
  Uninstall-WindowsFeature -Name Windows-Defender
} else {
  Write-Output "Uninstall-WindowsFeature unavailable on this SKU (Defender stays disabled, not removed)"
}`,
        }).then(() => undefined),
    },
  ];
}

/**
 * CI-only: bake a read-only download cache (BUN_BUILD_PREFETCH_DIR) and warm
 * a shared `bun install` cache from a shallow clone of the bootstrapping
 * ref. Best-effort: a fork branch missing on the upstream remote or a
 * network blip skips the cache instead of failing the bake.
 */
async function prefetchBuildDeps(ctx: WindowsContext): Promise<void> {
  const { image, repoRef } = ctx;
  const clone = join(scratchDir, "bun-repo");
  const cloned = await run(["git", "clone", "--depth=1", "--branch", repoRef, "https://github.com/oven-sh/bun.git", clone], {
    allowFailure: true,
  });
  if (cloned.exitCode !== 0) {
    warn(`clone of ref "${repoRef}" failed; baking without warm caches`);
    return;
  }
  if (!existsSync(join(clone, "scripts", "prefetch-deps.ts")) && !mode.dryRun) {
    warn(`scripts/prefetch-deps.ts not present at ${repoRef}; skipping warm cache`);
    return;
  }
  const prefetchDir = image.paths.prefetchDir;
  await ensureDirectory(prefetchDir);
  // resolveConfig() walks up from cwd to find package.json — run from
  // inside the clone.
  const prefetch = await run(["bun", "scripts\\prefetch-deps.ts", prefetchDir], { cwd: clone, allowFailure: true });
  if (prefetch.exitCode !== 0) {
    warn("prefetch-deps.ts failed; baking without warm download cache");
    await removePaths(prefetchDir);
  } else {
    // Read-only: download.ts only ever copies FROM here, and a writable
    // baked input is something a misbehaving job could corrupt later.
    await makeReadOnlyRecursive(prefetchDir);
    await setMachineEnv("BUN_BUILD_PREFETCH_DIR", prefetchDir);
  }
  // Shared `bun install` download cache. Left writable: bun install
  // extracts new tarballs into the cache dir itself, so read-only would
  // fail on the first unseen package. The agent runs as SYSTEM, which can
  // write here.
  const cacheDir = image.paths.installCacheDir;
  await ensureDirectory(cacheDir);
  const rootInstall = await run(["bun", "install", "--ignore-scripts"], {
    cwd: clone,
    env: { BUN_INSTALL_CACHE_DIR: cacheDir },
    allowFailure: true,
  });
  const testInstall = await run(["bun", "install", "--ignore-scripts"], {
    cwd: join(clone, "test"),
    env: { BUN_INSTALL_CACHE_DIR: cacheDir },
    allowFailure: true,
  });
  if (rootInstall.exitCode !== 0 || testInstall.exitCode !== 0) {
    warn("bun install prefetch failed; baking without warm install cache");
    await removePaths(cacheDir);
  } else {
    await setMachineEnv("BUN_INSTALL_CACHE_DIR", cacheDir);
  }
  // The installs leave ~2 GB of node_modules in the clone (test/ uses the
  // isolated linker).
  await removeTreeRobustly(clone);
}
