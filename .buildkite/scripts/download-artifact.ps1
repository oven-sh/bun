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

function Assert-Join-File() {
  if (-not (Get-Command "Join-File" -ErrorAction SilentlyContinue)) {
    Write-Error "Cannot find Join-File, please install it: https://www.powershellgallery.com/packages/FileSplitter/1.3"
    exit 1
  }
}

function Download-Buildkite-Artifact() {
  param (
    [Parameter(Mandatory=$true)]
    [string] $Path,
  )
  if ($Split) {
    & buildkite-agent artifact download "$Path.*" --debug --debug-http
    Join-File -Path "$(Resolve-Path .)\$Path" -Verbose -DeletePartFiles
  } else {
    & buildkite-agent artifact download "$Path" --debug --debug-http
  }
  if (-not (Test-Path $Path)) {
    Write-Error "Could not find artifact: $Path"
    exit 1
  }
}

Assert-Buildkite-Agent
if ($Split) {
  Assert-Join-File
}

foreach ($Path in $Paths) {
  Download-Buildkite-Artifact $Path
}
