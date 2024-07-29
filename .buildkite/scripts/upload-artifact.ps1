param (
  [Parameter(Mandatory=$true)]
  [string[]] $Paths,
  [switch] $Split
)

$ErrorActionPreference = "Stop"

function Assert-Buildkite-Agent() {
  if (-not (Get-Command "buildkite-agent" -ErrorAction SilentlyContinue)) {
    Write-Error "Cannot find buildkite-agent, please install it: https://buildkite.com/docs/agent/v3/install"
    exit 1
  }
}

function Assert-Split-File() {
  if (-not (Get-Command "Split-File" -ErrorAction SilentlyContinue)) {
    Write-Error "Cannot find Split-File, please install it: https://www.powershellgallery.com/packages/FileSplitter/1.3"
    exit 1
  }
}

function Upload-Buildkite-Artifact() {
  param (
    [Parameter(Mandatory=$true)]
    [string] $Path,
  )
  if (-not (Test-Path $Path)) {
    Write-Error "Could not find artifact: $Path"
    exit 1
  }
  if ($Split) {
    Remove-Item -Path "$Path.*" -Force
    Split-File -Path (Resolve-Path $Path) -PartSizeBytes "50MB" -Verbose
    $Path = "$Path.*"
  }
  & buildkite-agent artifact upload "$Path" --debug --debug-http
}

Assert-Buildkite-Agent
if ($Split) {
  Assert-Split-File
}

foreach ($Path in $Paths) {
  Upload-Buildkite-Artifact $Path
}
