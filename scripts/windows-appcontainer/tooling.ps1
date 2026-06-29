param([switch]$Bare, [string]$CacheDir = '', [string]$Label = '')
$ErrorActionPreference = 'Continue'
$env:BUN_DEBUG_QUIET_LOGS = '1'
$bun = 'C:\ac\bin\bun.exe'
$wd = 'C:\ac\proj\t3'
Remove-Item -Recurse -Force $wd -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$wd\out" | Out-Null
Set-Content "$wd\package.json" '{"name":"t3","version":"1.0.0","dependencies":{"left-pad":"1.3.0"},"scripts":{"hello":"echo HELLO_FROM_SCRIPT","postinstall":"bun -e \"console.log(1,''POSTINSTALL_RAN'')\""}}'
Set-Content "$wd\e.ts" 'const x: number = 41; console.log("BUILT", x + 1); export {};'
Set-Content "$wd\t.test.ts" 'import {test, expect} from "bun:test"; test("adds", () => { expect(1+1).toBe(2); });'
if ($CacheDir) { $env:BUN_INSTALL_CACHE_DIR = $CacheDir; New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null } else { Remove-Item Env:BUN_INSTALL_CACHE_DIR -ErrorAction SilentlyContinue }
function Run($name, $cmdline, $tmo = 120) {
  Write-Output "##### $name [$Label] #####"
  if ($Bare) {
    Push-Location $wd
    & $bun @cmdline 2>&1 | Select-Object -Last 30 | ForEach-Object { "$_" }
    Write-Output "exit=$LASTEXITCODE"
    Pop-Location
  } else {
    & C:\ac\bin\ac_run.exe --quiet --timeout $tmo --cwd $wd -- $bun @cmdline 2>&1 | Select-Object -Last 30 | ForEach-Object { "$_" }
    Write-Output "exit=$LASTEXITCODE"
  }
}
Run 'bun install' @('install')
Run 'bun run script' @('run', 'hello')
Run 'bun add is-odd' @('add', 'is-odd@3.0.1')
Run 'bun test' @('test', 't.test.ts')
Run 'bun build' @('build', './e.ts', '--outdir', 'out')
Run 'bun run e.ts' @('e.ts')
Run 'bunx cowsay' @('x', '--yes', 'cowsay@1.6.0', 'moo')
Run 'bun pm cache' @('pm', 'cache')
Run 'bun build --compile' @('build', './e.ts', '--compile', '--outfile', 'compiled.exe') 240
