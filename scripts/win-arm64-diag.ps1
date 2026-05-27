# Temporary diagnostic for the cross-compiled windows-aarch64 bun.exe crashing
# with STATUS_HEAP_CORRUPTION (0xC0000374) on the ARM64 test fleet.
# Runs a small matrix of invocations and dumps recent WER application-error
# events so the faulting module/offset is visible. Never fails the step.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

Write-Host "--- Downloading windows-aarch64 artifact"
if ($env:DIAG_ARTIFACT_BUILD) {
  buildkite-agent artifact download "bun-windows-aarch64.zip" . --build $env:DIAG_ARTIFACT_BUILD
} else {
  buildkite-agent artifact download "bun-windows-aarch64.zip" . --step "windows-aarch64-build-bun"
}
Expand-Archive -Force bun-windows-aarch64.zip -DestinationPath diag-bin
$bun = (Resolve-Path "diag-bin\bun-windows-aarch64\bun.exe").Path
Write-Host "bun.exe: $bun"
Get-Item $bun | Format-List Name, Length, VersionInfo | Out-String | Write-Host

function Invoke-Case {
  # NOTE: parameter must not be called $Args — PowerShell's automatic $args
  # shadows it inside the function body and the splat passes nothing.
  param([string]$Name, [hashtable]$CaseEnv, [string[]]$CaseArgs, [string]$Cwd)
  Write-Host "--- case: $Name"
  foreach ($k in $CaseEnv.Keys) { Set-Item -Path "Env:$k" -Value $CaseEnv[$k] }
  try {
    if ($Cwd) { Push-Location $Cwd }
    & $bun @CaseArgs 2>&1 | Select-Object -First 60 | Out-String | Write-Host
    $code = $LASTEXITCODE
    if ($Cwd) { Pop-Location }
  } catch {
    Write-Host "exception: $_"
    $code = -1
  }
  foreach ($k in $CaseEnv.Keys) { Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue }
  $hex = "0x{0:X8}" -f ($code -band 0xFFFFFFFF)
  Write-Host "exit($Name): $code ($hex)"
}

Invoke-Case -Name "revision"            -CaseEnv @{}                                                   -CaseArgs @("--revision")
Invoke-Case -Name "version"             -CaseEnv @{}                                                   -CaseArgs @("--version")
Invoke-Case -Name "eval"                -CaseEnv @{}                                                   -CaseArgs @("-e", "console.log(1)")
Invoke-Case -Name "eval-jit-off"        -CaseEnv @{ BUN_JSC_useJIT = "0" }                             -CaseArgs @("-e", "console.log(1)")
Invoke-Case -Name "eval-mimalloc-dbg"   -CaseEnv @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -CaseArgs @("-e", "console.log(1)")
Invoke-Case -Name "revision-mimalloc"   -CaseEnv @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -CaseArgs @("--revision")
Invoke-Case -Name "eval-smol"           -CaseEnv @{}                                                   -CaseArgs @("--smol", "-e", "console.log(1)")
Invoke-Case -Name "eval-gc"             -CaseEnv @{}                                                   -CaseArgs @("-e", "Bun.gc(true); console.log('gc ok')")

New-Item -ItemType Directory -Force -Path diag-install | Out-Null
'{"name":"diag","version":"1.0.0","dependencies":{}}' | Out-File -Encoding ascii diag-install\package.json
Invoke-Case -Name "install-empty"       -CaseEnv @{}                                                   -CaseArgs @("install") -Cwd "diag-install"
Invoke-Case -Name "install-mimalloc"    -CaseEnv @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -CaseArgs @("install") -Cwd "diag-install"

# Enable WER local crash dumps for bun.exe (best-effort; agent may not be admin)
try {
  $dumpDir = Join-Path (Get-Location) "diag-dumps"
  New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null
  $key = "HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\bun.exe"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name DumpFolder -Value $dumpDir -Type ExpandString
  Set-ItemProperty -Path $key -Name DumpType -Value 2 -Type DWord
  Set-ItemProperty -Path $key -Name DumpCount -Value 4 -Type DWord
  Write-Host "WER LocalDumps enabled -> $dumpDir"
} catch { Write-Host "WER LocalDumps setup failed: $_" }

# The case that crashes (diag v2): `bun install` on the repo root package.json
# (exit 0xC0000374). Bisect which part of the install does it.
$repoRoot = $env:BUILDKITE_BUILD_CHECKOUT_PATH
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
Write-Host "repo root: $repoRoot"

function Clean-NodeModules {
  Remove-Item -Recurse -Force (Join-Path $repoRoot "node_modules") -ErrorAction SilentlyContinue
}

Clean-NodeModules
Invoke-Case -Name "install-root-verbose"      -CaseEnv @{}                                                   -CaseArgs @("install", "--verbose") -Cwd $repoRoot
Clean-NodeModules
Invoke-Case -Name "install-root-no-scripts"   -CaseEnv @{}                                                   -CaseArgs @("install", "--ignore-scripts") -Cwd $repoRoot
Clean-NodeModules
Invoke-Case -Name "install-root-copyfile"     -CaseEnv @{}                                                   -CaseArgs @("install", "--backend=copyfile") -Cwd $repoRoot
Clean-NodeModules
Invoke-Case -Name "install-root-serial"       -CaseEnv @{}                                                   -CaseArgs @("install", "--network-concurrency=1") -Cwd $repoRoot
Clean-NodeModules
Invoke-Case -Name "install-root-mimalloc"     -CaseEnv @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -CaseArgs @("install") -Cwd $repoRoot

# Multi-package add into a clean dir (no workspace, no lifecycle scripts)
New-Item -ItemType Directory -Force -Path diag-add | Out-Null
'{"name":"diag-add","version":"1.0.0"}' | Out-File -Encoding ascii diag-add\package.json
Invoke-Case -Name "add-real-packages"         -CaseEnv @{}                                                   -CaseArgs @("add", "typescript", "react", "esbuild", "lodash") -Cwd "diag-add"

# Try to capture a crash dump with procdump (native ARM64 build) around the crashing case
try {
  Invoke-WebRequest -Uri "https://live.sysinternals.com/procdump64a.exe" -OutFile procdump64a.exe -UseBasicParsing
  Write-Host "procdump64a downloaded: $((Get-Item procdump64a.exe).Length) bytes"
  Clean-NodeModules
  Push-Location $repoRoot
  & "$PWD\..\procdump64a.exe" -accepteula -ma -e 1 -x (Join-Path (Split-Path $bun -Parent) "..\..\diag-dumps") $bun install 2>&1 | Select-Object -Last 40 | Out-String | Write-Host
  Pop-Location
} catch { Write-Host "procdump capture failed: $_" }

# A trivial bun test run
'import { test, expect } from "bun:test"; test("ok", () => { expect(1 + 1).toBe(2); });' | Out-File -Encoding ascii diag-install\trivial.test.ts
Invoke-Case -Name "bun-test-trivial"    -CaseEnv @{}                                                   -CaseArgs @("test", "trivial.test.ts") -Cwd "diag-install"

Write-Host "--- crash dumps collected"
try {
  $dumpLocations = @($dumpDir, (Join-Path (Get-Location) "diag-dumps"), "$env:LOCALAPPDATA\CrashDumps", "C:\Windows\System32\config\systemprofile\AppData\Local\CrashDumps")
  foreach ($loc in $dumpLocations) {
    if (Test-Path $loc) {
      Get-ChildItem -Path $loc -Filter *.dmp -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "dump: $($_.FullName) ($($_.Length) bytes)"
        Copy-Item $_.FullName -Destination $dumpDir -ErrorAction SilentlyContinue
      }
    }
  }
  if (Test-Path $dumpDir) {
    Push-Location $dumpDir
    buildkite-agent artifact upload "*.dmp"
    Pop-Location
  }
} catch { Write-Host "dump collection failed: $_" }

Write-Host "--- Recent Application error events (WER) mentioning bun"
try {
  Get-WinEvent -FilterHashtable @{ LogName = "Application"; Id = 1000, 1001 } -MaxEvents 30 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match "bun" } |
    Select-Object -First 8 |
    ForEach-Object { Write-Host "==== $($_.TimeCreated)"; Write-Host $_.Message }
} catch { Write-Host "Get-WinEvent failed: $_" }

Write-Host "--- done"
exit 0
