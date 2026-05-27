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
$logDir = Join-Path (Get-Location) "diag-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
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
    $caseLog = Join-Path $logDir ("$Name.log")
    # Redirect natively to a file (no PowerShell error-record munging, no
    # truncation); print the tail afterwards.
    cmd /c "`"$bun`" $($CaseArgs -join ' ') > `"$caseLog`" 2>&1"
    $code = $LASTEXITCODE
    if (Test-Path $caseLog) { Get-Content $caseLog -Tail 30 | Out-String | Write-Host }
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

# Output-mode matrix: the test runner (which reproduces the crash 100%) pipes
# bun's stdout/stderr; redirecting to a file (diag v4) made the crash vanish.
# Distinguish "output written to a pipe" from everything else, and whether
# silencing the install output (--silent) avoids it.
function Invoke-PipedCase {
  param([string]$Name, [string[]]$CaseArgs, [string]$Cwd, [switch]$Truncate)
  Write-Host "--- case: $Name (piped)"
  try {
    if ($Cwd) { Push-Location $Cwd }
    if ($Truncate) {
      & $bun @CaseArgs 2>&1 | Select-Object -First 40 | Out-String | Write-Host
    } else {
      & $bun @CaseArgs 2>&1 | Out-Null
    }
    $code = $LASTEXITCODE
    if ($Cwd) { Pop-Location }
  } catch { Write-Host "exception: $($_.Exception.Message)"; $code = -1; Pop-Location -ErrorAction SilentlyContinue }
  $hex = "0x{0:X8}" -f ($code -band 0xFFFFFFFF)
  Write-Host "exit($Name): $code ($hex)"
}

Clean-NodeModules
Invoke-PipedCase -Name "install-pipe-consumed-1"  -CaseArgs @("install") -Cwd $repoRoot
Clean-NodeModules
Invoke-PipedCase -Name "install-pipe-consumed-2"  -CaseArgs @("install") -Cwd $repoRoot
Clean-NodeModules
Invoke-PipedCase -Name "install-pipe-truncated"   -CaseArgs @("install") -Cwd $repoRoot -Truncate
Clean-NodeModules
Invoke-PipedCase -Name "install-pipe-silent"      -CaseArgs @("install", "--silent") -Cwd $repoRoot
Clean-NodeModules
Invoke-Case      -Name "install-file-redirect"    -CaseEnv @{} -CaseArgs @("install") -Cwd $repoRoot
Clean-NodeModules
Invoke-PipedCase -Name "install-pipe-no-scripts"  -CaseArgs @("install", "--ignore-scripts") -Cwd $repoRoot

# Crash dump capture with procdump (ARM64 native build). Try two sources.
$procdump = Join-Path (Get-Location) "procdump64a.exe"
foreach ($url in @("https://live.sysinternals.com/procdump64a.exe", "https://download.sysinternals.com/files/Procdump.zip")) {
  try {
    if ($url.EndsWith(".zip")) {
      Invoke-WebRequest -Uri $url -OutFile procdump.zip -UseBasicParsing
      Expand-Archive -Force procdump.zip -DestinationPath procdump-extracted
      Copy-Item procdump-extracted\procdump64a.exe $procdump -Force
    } else {
      Invoke-WebRequest -Uri $url -OutFile $procdump -UseBasicParsing
    }
    if (Test-Path $procdump) { Write-Host "procdump ready from $url ($((Get-Item $procdump).Length) bytes)"; break }
  } catch { Write-Host "procdump fetch from $url failed: $($_.Exception.Message)" }
}
if (Test-Path $procdump) {
  try {
    Clean-NodeModules
    Push-Location $repoRoot
    & $procdump -accepteula -ma -e 1 -x $dumpDir $bun install 2>&1 | Select-Object -Last 50 | Out-String | Write-Host
    Write-Host "procdump run exit: $LASTEXITCODE"
    Pop-Location
  } catch { Write-Host "procdump capture failed: $($_.Exception.Message)"; Pop-Location -ErrorAction SilentlyContinue }
}

Write-Host "--- Application event log (last hour, error/WER events)"
try {
  Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = (Get-Date).AddHours(-1) } -MaxEvents 200 -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -in 1000, 1001, 1002 -or $_.LevelDisplayName -eq "Error" } |
    Select-Object -First 12 |
    ForEach-Object { Write-Host "==== [$($_.Id)] $($_.TimeCreated)"; Write-Host $_.Message }
} catch { Write-Host "Get-WinEvent failed: $_" }

# Upload the per-case logs
try { Push-Location $logDir; buildkite-agent artifact upload "*.log"; Pop-Location } catch { Write-Host "log upload failed: $_" }

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
