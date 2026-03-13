#!/usr/bin/env pwsh

$buildOutput = & bun run --silent build:debug 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output $buildOutput
    exit $LASTEXITCODE
}

& ./build/debug/bun-debug @args
exit $LASTEXITCODE
