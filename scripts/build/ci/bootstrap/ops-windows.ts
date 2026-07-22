// Windows system operations: the vocabulary windows bootstrap steps are
// written in.
//
// Mirrors ./ops-posix.ts for the concepts that are shared (directories,
// copies, archives, downloads happen via runtime.download), and adds the
// Windows tail: msi/exe installers, machine environment, PATH, service
// startup, registry values, scheduled tasks, firewall rules. Each op logs
// intent in plain terms and executes a small PowerShell fragment through
// runtime.run(), so quoting lives here — once — not at every call site.
//
// The genuine one-off scripts use the labeled escape hatch
// powershellScript(), whose required `describe` makes the exception
// visible in the code and the log.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunOptions, RunResult } from "./runtime.ts";
import { invalidateChildPath, log, mode, run, runOutput, scratchDir, verify } from "./runtime.ts";

// ---------------------------------------------------------------------------
// PowerShell plumbing
// ---------------------------------------------------------------------------

/** A PowerShell single-quoted string literal ('' escapes a quote). */
export function psq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Run a PowerShell fragment (echoed in full, output streamed).
 *
 * Every fragment runs under $ErrorActionPreference = 'Stop', the semantics
 * bootstrap.ps1 had globally: a non-terminating cmdlet error mid-fragment
 * ABORTS the fragment (non-zero exit → the step fails) instead of printing
 * and letting a trailing statement exit 0. Without this, "install failed"
 * followed by Write-Output "done" would ship a broken image as a success.
 * Fragments that legitimately tolerate errors set their own preference or
 * -ErrorAction per statement.
 */
let psScriptCounter = 0;

async function ps(script: string, options: RunOptions = {}): Promise<RunResult> {
  const strict = `$ErrorActionPreference = 'Stop'\r\n${script}\r\n`;
  // Run the script from a file, not on the command line. Windows inspects
  // a new process's command line before creating it, and a script whose
  // TEXT it flags (the Defender-feature removal) is refused at CreateProcess
  // (EPERM) before it can even start. A -File path carries no script text.
  // It is also how a many-line script is meant to run; the echoed log
  // still shows the full script.
  log(`script text (${strict.split(/\r?\n/).length} line(s)) -> temp .ps1:`);
  for (const line of script.split(/\r?\n/)) log(`    | ${line}`);
  const file = join(scratchDir, `step-${++psScriptCounter}.ps1`);
  if (!mode.dryRun) writeFileSync(file, strict);
  return run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], options);
}

/**
 * Run a read-only PowerShell PROBE and return its stdout. A probe answers a
 * question ("is scoop on PATH?", "where is nssm.exe?") whose "not found"
 * case is a NORMAL result encoded as empty output — not a failure. Windows
 * PowerShell 5.1 maps a cmdlet that found nothing to $? = $false and exits
 * the process with 1, which would misread a normal "no" as an error; the
 * appended `exit 0` pins the exit code so only stdout carries meaning.
 */
function psProbe(script: string): Promise<string> {
  // Same launch mechanism as ps(): a file, not the command line. The
  // trailing `exit 0` pins the exit code so only stdout carries meaning.
  const file = join(scratchDir, `probe-${++psScriptCounter}.ps1`);
  if (!mode.dryRun) writeFileSync(file, `${script}\r\nexit 0\r\n`);
  return runOutput(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]);
}

// ---------------------------------------------------------------------------
// Files and directories
// ---------------------------------------------------------------------------

export async function ensureDirectory(path: string): Promise<void> {
  log(`ensuring directory ${path}`);
  await ps(`New-Item -ItemType Directory -Force -Path ${psq(path)} | Out-Null`);
}

/** Remove files/directories recursively (missing paths are fine). */
export async function removePaths(...paths: string[]): Promise<void> {
  log(`removing ${paths.join(", ")}`);
  await ps(paths.map(p => `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue ${psq(p)}`).join("\n"));
}

/**
 * Remove a big tree (node_modules with junctions / deep paths) using cmd's
 * rmdir, which handles what Remove-Item -Recurse trips over.
 */
export async function removeTreeRobustly(path: string): Promise<void> {
  log(`removing tree ${path} (rmdir /s /q)`);
  // Best-effort cleanup: a locked leftover in a scratch clone must not
  // fail the bake; sysprep wipes the temp tree regardless.
  // Path is its own argv element: node quotes it correctly for cmd. An
  // embedded \"path\" would be backslash-escaped by libuv and rejected.
  await run(["cmd", "/c", "rmdir", "/s", "/q", path], { allowFailure: true });
}

/** Merge the CONTENTS of `from` into `into`. */
export async function copyIntoDirectory(from: string, into: string): Promise<void> {
  log(`copying contents of ${from} into ${into}`);
  await ps(`New-Item -ItemType Directory -Force -Path ${psq(into)} | Out-Null
Copy-Item -Path (Join-Path ${psq(from)} '*') -Destination ${psq(into)} -Recurse -Force`);
}

/** Copy one file to a destination, replacing whatever is there. */
export async function installFile(spec: { from: string; to: string }): Promise<void> {
  log(`installing ${spec.from} → ${spec.to}`);
  await ps(`Copy-Item ${psq(spec.from)} ${psq(spec.to)} -Force`);
}

export async function moveDirectory(from: string, to: string): Promise<void> {
  log(`moving ${from} → ${to}`);
  await ps(`Move-Item ${psq(from)} ${psq(to)} -Force`);
}

/**
 * The first file matching a name anywhere under a directory (e.g. bun.exe
 * inside an extracted release whose folder name we don't want to pin).
 * Returns the path or undefined. A probe: runs even in dry-run — but the
 * directory may not exist there, so dry-run answers undefined.
 */
export async function findFile(under: string, fileName: string): Promise<string | undefined> {
  if (mode.dryRun) {
    log(`[dry-run] would locate ${fileName} under ${under}`);
    return `${under}\\${fileName}`;
  }
  const output = await psProbe(
    `$f = Get-ChildItem ${psq(under)} -Recurse -Filter ${psq(fileName)} -ErrorAction SilentlyContinue | Select-Object -First 1
if ($f) { $f.FullName }`,
  );
  return output || undefined;
}

/** The first directory named `dirName` anywhere under `under` (a probe;
 * dry-run answers a plausible path). */
export async function findDirectory(under: string, dirName: string): Promise<string | undefined> {
  if (mode.dryRun) {
    log(`[dry-run] would locate directory ${dirName} under ${under}`);
    return `${under}\\${dirName}`;
  }
  const output = await psProbe(
    `$d = Get-ChildItem ${psq(under)} -Recurse -Directory -Filter ${psq(dirName)} -ErrorAction SilentlyContinue | Select-Object -First 1
if ($d) { $d.FullName }`,
  );
  return output || undefined;
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

/**
 * Extract an archive into a directory, choosing the tool from the extension:
 * .zip → Expand-Archive; .tar.xz/.txz → 7z twice (Server 2019's bundled
 * bsdtar has no liblzma); .tar.gz → tar.
 */
export async function extractArchive(spec: { file: string; into: string; stripComponents?: number }): Promise<void> {
  const { file, into } = spec;
  log(`extracting ${file} into ${into}`);
  if (/\.zip$/i.test(file)) {
    await ps(`New-Item -ItemType Directory -Force -Path ${psq(into)} | Out-Null
Expand-Archive -Path ${psq(file)} -DestinationPath ${psq(into)} -Force`);
  } else if (/\.(tar\.xz|txz)$/i.test(file)) {
    await ps(
      `New-Item -ItemType Directory -Force -Path ${psq(into)} | Out-Null
& 7z x ${psq(file)} "-o${into}" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z failed to decompress ${file}" }
$tar = Get-ChildItem ${psq(into)} -Filter *.tar | Select-Object -First 1
if (-not $tar) { throw "no .tar found inside ${file}" }
& 7z x $tar.FullName "-o${into}" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z failed to untar $($tar.FullName)" }
Remove-Item $tar.FullName -Force`,
    );
  } else {
    const strip = spec.stripComponents ? ` --strip-components=${spec.stripComponents}` : "";
    await ps(`New-Item -ItemType Directory -Force -Path ${psq(into)} | Out-Null
tar -xzf ${psq(file)} -C ${psq(into)}${strip}
if ($LASTEXITCODE -ne 0) { throw "tar failed to extract ${file}" }`);
  }
}

// ---------------------------------------------------------------------------
// Installers
// ---------------------------------------------------------------------------

/**
 * Run an .msi silently. Non-zero exit is a failure unless listed in
 * validExitCodes (3010 = success + reboot required).
 */
export async function msiInstall(spec: { path: string; extraArgs: string[]; validExitCodes: number[] }): Promise<void> {
  const args = ["/i", `"${spec.path}"`, "/quiet", "/norestart", ...spec.extraArgs].join(" ");
  log(`msiexec ${args}`);
  await ps(
    `$p = Start-Process msiexec -ArgumentList ${psq(args)} -Wait -PassThru -NoNewWindow
if (@(${spec.validExitCodes.join(",")}) -notcontains $p.ExitCode) { throw "msiexec failed: exit code $($p.ExitCode)" }
Write-Output "msiexec exit code: $($p.ExitCode)"`,
  );
}

/** Run an .exe installer with arguments; validExitCodes as for msi. */
export async function exeInstall(spec: { path: string; args: string[]; validExitCodes: number[] }): Promise<void> {
  log(`running installer ${spec.path} ${spec.args.join(" ")}`);
  await ps(
    `$p = Start-Process ${psq(spec.path)} -ArgumentList ${psq(spec.args.join(" "))} -Wait -PassThru -NoNewWindow
if (@(${spec.validExitCodes.join(",")}) -notcontains $p.ExitCode) { throw "installer failed: exit code $($p.ExitCode)" }
Write-Output "installer exit code: $($p.ExitCode)"`,
  );
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Machine-scope environment variable (survives sysprep, unlike User). */
export async function setMachineEnv(name: string, value: string): Promise<void> {
  log(`machine env ${name}=${value}`);
  await ps(`[System.Environment]::SetEnvironmentVariable(${psq(name)}, ${psq(value)}, 'Machine')`);
}

/** Append a directory to the machine PATH if it isn't already there. */
export async function addToMachinePath(dir: string): Promise<void> {
  log(`machine PATH += ${dir} (if absent)`);
  // The registry PATH is about to change: children must re-read it.
  invalidateChildPath();
  await ps(
    `$p = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (($p -split ';') -notcontains ${psq(dir)}) {
  [Environment]::SetEnvironmentVariable('Path', $p.TrimEnd(';') + ';' + ${psq(dir)}, 'Machine')
  Write-Output "PATH += ${dir}"
} else {
  Write-Output "PATH already contains ${dir}"
}`,
  );
}

/**
 * Resolve a command against a PATH freshly read from the registry (this
 * session's PATH is stale after installers write to Machine PATH). A probe
 * of the target's PATH: off-target (dry-run) it can't be answered, so plan
 * as "not installed yet" — which prints the install.
 */
export async function commandOnPath(command: string): Promise<string | undefined> {
  if (mode.dryRun) {
    log(`[dry-run] would check whether "${command}" is on PATH (assuming not yet)`);
    return undefined;
  }
  const output = await psProbe(
    `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$c = Get-Command ${psq(command)} -ErrorAction SilentlyContinue
if ($c) { $c.Path }`,
  );
  return output || undefined;
}

// ---------------------------------------------------------------------------
// Services, registry, tasks, firewall
// ---------------------------------------------------------------------------

/** Stop a service now and disable it (missing service = no-op). */
export async function stopAndDisableService(name: string): Promise<void> {
  log(`stopping and disabling service ${name}`);
  await ps(
    `$s = Get-Service -Name ${psq(name)} -ErrorAction SilentlyContinue
if ($s) {
  Stop-Service ${psq(name)} -Force -ErrorAction SilentlyContinue
  Set-Service ${psq(name)} -StartupType Disabled -ErrorAction SilentlyContinue
  Write-Output "disabled service ${name}"
} else { Write-Output "service ${name} not present" }`,
    { allowFailure: true },
  );
}

/** Whether a service exists (probe). */
export async function serviceExists(name: string): Promise<boolean> {
  if (mode.dryRun) {
    log(`[dry-run] would check whether service "${name}" exists (assuming not)`);
    return false;
  }
  const output = await psProbe(`(Get-Service -Name ${psq(name)} -ErrorAction SilentlyContinue).Status`);
  return output.length > 0;
}

/** Register a script to run as SYSTEM at every boot. */
export async function registerStartupTask(spec: { name: string; scriptPath: string }): Promise<void> {
  log(`scheduled task ${spec.name}: run ${spec.scriptPath} at startup as SYSTEM`);
  await ps(
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + ${psq(spec.scriptPath)} + '"')
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName ${psq(spec.name)} -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Output "registered task ${spec.name}"`,
  );
}

/** Allow inbound TCP on a port (idempotent by rule name). */
export async function allowInboundTcp(spec: { ruleName: string; displayName: string; port: number }): Promise<void> {
  log(`firewall: allow inbound TCP ${spec.port} (${spec.ruleName})`);
  await ps(
    `if (-not (Get-NetFirewallRule -Name ${psq(spec.ruleName)} -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Profile Any -Name ${psq(spec.ruleName)} -DisplayName ${psq(spec.displayName)} -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort ${spec.port} | Out-Null
  Write-Output "created rule ${spec.ruleName}"
} else { Write-Output "rule ${spec.ruleName} already exists" }`,
  );
}

/** Make a file/tree read-only via attrib (a robust r/o marker on NTFS). */
export async function makeReadOnlyRecursive(path: string): Promise<void> {
  log(`marking ${path} read-only`);
  await ps(`& attrib +R (Join-Path ${psq(path)} '*') /S /D`);
}

// ---------------------------------------------------------------------------
// Escape hatch
// ---------------------------------------------------------------------------

export type PowershellScriptSpec = {
  /** What the script accomplishes — required, printed in the log. This is
   * what makes a raw script an explicit, labeled exception. */
  describe: string;
  script: string;
  allowFailure?: boolean;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

/** Run a multi-line PowerShell script for the operations that are
 * genuinely scripts (sysprep, an installer with its own control flow). */
export function powershellScript(spec: PowershellScriptSpec): Promise<RunResult> {
  log(`script: ${spec.describe}`);
  const options: RunOptions = {};
  if (spec.cwd !== undefined) options.cwd = spec.cwd;
  if (spec.env !== undefined) options.env = spec.env;
  if (spec.allowFailure !== undefined) options.allowFailure = spec.allowFailure;
  return ps(spec.script, options);
}

/** A named check that a step produced what it should. */
export { verify };
