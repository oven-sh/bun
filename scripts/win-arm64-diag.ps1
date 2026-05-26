# Temporary diagnostic for the cross-compiled windows-aarch64 bun.exe crashing
# with STATUS_HEAP_CORRUPTION (0xC0000374) on the ARM64 test fleet.
# Runs a small matrix of invocations and dumps recent WER application-error
# events so the faulting module/offset is visible. Never fails the step.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

Write-Host "--- Downloading windows-aarch64 artifact"
buildkite-agent artifact download "bun-windows-aarch64.zip" . --step "windows-aarch64-build-bun"
Expand-Archive -Force bun-windows-aarch64.zip -DestinationPath diag-bin
$bun = (Resolve-Path "diag-bin\bun-windows-aarch64\bun.exe").Path
Write-Host "bun.exe: $bun"
Get-Item $bun | Format-List Name, Length, VersionInfo | Out-String | Write-Host

function Invoke-Case {
  param([string]$Name, [hashtable]$Env, [string[]]$Args, [string]$Cwd)
  Write-Host "--- case: $Name"
  foreach ($k in $Env.Keys) { Set-Item -Path "Env:$k" -Value $Env[$k] }
  try {
    if ($Cwd) { Push-Location $Cwd }
    & $bun @Args 2>&1 | Select-Object -First 40 | Out-String | Write-Host
    $code = $LASTEXITCODE
    if ($Cwd) { Pop-Location }
  } catch {
    Write-Host "exception: $_"
    $code = -1
  }
  foreach ($k in $Env.Keys) { Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue }
  $hex = "0x{0:X8}" -f ($code -band 0xFFFFFFFF)
  Write-Host "exit($Name): $code ($hex)"
}

Invoke-Case -Name "revision"            -Env @{}                                                   -Args @("--revision")
Invoke-Case -Name "version"             -Env @{}                                                   -Args @("--version")
Invoke-Case -Name "eval"                -Env @{}                                                   -Args @("-e", "console.log(1)")
Invoke-Case -Name "eval-jit-off"        -Env @{ BUN_JSC_useJIT = "0" }                             -Args @("-e", "console.log(1)")
Invoke-Case -Name "eval-mimalloc-dbg"   -Env @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -Args @("-e", "console.log(1)")
Invoke-Case -Name "revision-mimalloc"   -Env @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -Args @("--revision")
Invoke-Case -Name "eval-smol"           -Env @{}                                                   -Args @("--smol", "-e", "console.log(1)")
Invoke-Case -Name "eval-gc"             -Env @{}                                                   -Args @("-e", "Bun.gc(true); console.log('gc ok')")

New-Item -ItemType Directory -Force -Path diag-install | Out-Null
'{"name":"diag","version":"1.0.0","dependencies":{}}' | Out-File -Encoding ascii diag-install\package.json
Invoke-Case -Name "install-empty"       -Env @{}                                                   -Args @("install") -Cwd "diag-install"
Invoke-Case -Name "install-mimalloc"    -Env @{ MIMALLOC_SHOW_ERRORS = "1"; MIMALLOC_VERBOSE = "1" } -Args @("install") -Cwd "diag-install"

Write-Host "--- Recent Application error events (WER) mentioning bun"
try {
  Get-WinEvent -FilterHashtable @{ LogName = "Application"; Id = 1000, 1001 } -MaxEvents 30 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match "bun" } |
    Select-Object -First 8 |
    ForEach-Object { Write-Host "==== $($_.TimeCreated)"; Write-Host $_.Message }
} catch { Write-Host "Get-WinEvent failed: $_" }

Write-Host "--- done"
exit 0
