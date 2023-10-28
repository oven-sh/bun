param (
  [Parameter(Mandatory)]
  [string]$OutDir,
  [Parameter(Mandatory)][string]$Tag,
  [Parameter(Mandatory)][string]$PackageName
)

$ErrorActionPreference = "Stop"

$Url = "https://github.com/oven-sh/WebKit/releases/download/autobuild-$Tag/$PackageName.tar.gz"
$CacheDir = (mkdir -Force (Join-Path $PSScriptRoot "../.webkit-cache"))
$TarPath = Join-Path $CacheDir "$PackageName-$Tag.tar.gz"

if (Test-Path $OutDir\.tag) {
  $CurrentTag = Get-Content -Path (Join-Path $OutDir ".tag")
  if ($CurrentTag -eq $Tag) {
    return
  }
}

Remove-Item $OutDir -ErrorAction SilentlyContinue -Recurse
$null = mkdir -Force $OutDir
Write-Host "-- Downloading WebKit"
if (!(Test-Path $TarPath)) {
  Invoke-WebRequest $Url -OutFile $TarPath
}

Push-Location $CacheDir
tar.exe "-xzf" "$PackageName-$Tag.tar.gz" -C ([IO.Path]::GetRelativePath($CacheDir, $OutDir + "/../").replace('\', '/'))
Pop-Location

Set-Content -Path (Join-Path $OutDir ".tag") -Value "$Tag"