$ErrorActionPreference = "Stop"

$ZigVersion="0.13.0"
$Target="windows"
$Arch="x86_64"

$Url = "https://ziglang.org/builds/zig-${Target}-${Arch}-${ZigVersion}.zip"
$CacheDir = (mkdir -Force (Join-Path $PSScriptRoot "../.cache"))
$TarPath = Join-Path $CacheDir "zig-${ZigVersion}.zip"
$OutDir = Join-Path $CacheDir "zig"

if (Test-Path $OutDir\.tag) {
  $CurrentTag = Get-Content -Path (Join-Path $OutDir ".tag")
  if ($CurrentTag -eq $ZigVersion) {
    return
  }
}

Remove-Item $OutDir -ErrorAction SilentlyContinue -Recurse
$null = mkdir -Force $OutDir
Push-Location $CacheDir
try {
  if (!(Test-Path $TarPath)) {
    try {
      Write-Host "-- Downloading Zig"
      Invoke-RestMethod $Url -OutFile $TarPath -MaximumRetryCount 3 -RetryIntervalSec 1
    } catch {
      Write-Error "Failed to fetch Zig from: $Url"
      throw $_
    }
  }

  Remove-Item "$OutDir" -Recurse
  Expand-Archive "$TarPath" "$OutDir\..\"
  Move-Item "zig-$Target-$Arch-$ZigVersion" "zig"
  Set-Content -Path (Join-Path $OutDir ".tag") -Value "$ZigVersion"
} catch {
  Remove-Item -Force -ErrorAction SilentlyContinue $OutDir
  throw $_
} finally {
  Pop-Location
}