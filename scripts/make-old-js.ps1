$npm_client = "npm"

# & ${npm_client} i

$root = Join-Path (Split-Path -Path $MyInvocation.MyCommand.Definition -Parent) "..\"

# search for .cmd or .exe 
function Get-Esbuild-Path {
  param(
      $Path
  )

  $Result = Join-Path $Path "node_modules\.bin\esbuild.cmd"
  if (Test-Path $Result) {
      return $Result
  }

  return Join-Path $Path "node_modules\.bin\esbuild.exe"
}

$esbuild = Get-Esbuild-Path $root

$env:NODE_ENV = "production"

# runtime.js
echo $esbuild
& ${esbuild} `
    "--target=esnext" "--bundle" `
    "src/runtime.bun.js" `
    "--format=esm" "--platform=node" "--minify" "--external:/bun:*" `
    "--outfile=src/runtime.out.js"
if ($LASTEXITCODE -ne 0) { throw "esbuild failed with exit code $LASTEXITCODE" }

# fallback_decoder
& ${esbuild} --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

# bun-error
Push-Location packages\bun-error
& ${npm_client} install
& ${npm_client} run build
Pop-Location

# node-fallbacks
Push-Location src\node-fallbacks
& ${npm_client} install
& (Get-Esbuild-Path (Get-Location)) --bundle @(Get-Item .\*.js) --outdir=out --format=esm --minify --platform=browser
Pop-Location
