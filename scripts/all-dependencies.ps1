param(
  [Alias("f")][switch]$Force = $false
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot "env.ps1")

if ($env:CI) {
  & (Join-Path $PSScriptRoot "update-submodules.ps1")
}

$DidAnything = $false;

function Build-Dependency {
  param(
    $Script,
    [string[]]$Outputs
  )

  $ScriptPath = Join-Path $PSScriptRoot "build-$Script.ps1"
  
  if (!$Force) {
    foreach ($Output in $Outputs) {
      $OutputPath = Join-Path $BUN_DEPS_OUT_DIR $Output
      if (Test-Path $OutputPath) {
        Write-Host "$Script - already built"
        return
      }
    }
  }
  else {
    Remove-Item $Outputs -ErrorAction SilentlyContinue
  }

  Write-Host "$Script - Building"
  Push-Location $PSScriptRoot
  try {
    & $ScriptPath
  }
  catch {
    Write-Host "Failed to build $Script"
    throw $_
  }
  finally {
    Pop-Location
  }

  $Script:DidAnything = $true
}

Build-Dependency `
  -Script "boringssl" `
  -Outputs @("crypto.lib", "ssl.lib", "decrepit.lib")
Build-Dependency `
  -Script "cares" `
  -Outputs @("cares.lib")
Build-Dependency `
  -Script "libarchive" `
  -Outputs @("archive.lib")
Build-Dependency `
  -Script "lolhtml" `
  -Outputs @("lolhtml.lib")
Build-Dependency `
  -Script "mimalloc" `
  -Outputs @("mimalloc.lib")
Build-Dependency `
  -Script "tinycc" `
  -Outputs @("tcc.lib")
Build-Dependency `
  -Script "zlib" `
  -Outputs @("zlib.lib")
Build-Dependency `
  -Script "zstd" `
  -Outputs @("zstd.lib")
Build-Dependency `
  -Script "libuv" `
  -Outputs @("libuv.lib")
Build-Dependency `
  -Script "lshpack" `
  -Outputs @("lshpack.lib")

if (!($Script:DidAnything)) {
  Write-Host "(run with -Force to rebuild all)"
}
