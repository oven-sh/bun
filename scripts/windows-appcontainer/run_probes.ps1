param(
  [string]$Bun = 'C:\ac\bin\bun.exe',
  [string[]]$Probes = @('p_core','p_spawn','p_net','p_ext','p_misc'),
  [switch]$Bare,
  [string]$Name = 'bun.ac.dev',
  [string]$Caps = '',
  [int]$Timeout = 90,
  [string]$Wd = 'C:\ac\proj\t2'
)
$Probes = @($Probes | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$env:BUN_DEBUG_QUIET_LOGS = '1'
# reset probe work dir (keep sources + node_modules)
Get-ChildItem $Wd -Exclude p_*.mjs,_h.mjs,lib_ts.ts,node_modules,package.json -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
foreach ($p in $Probes) {
  $mode = if ($Bare) { 'bare' } else { "ac caps=$(if($Caps){$Caps}else{'default3'})" }
  Write-Output "##### $p [$mode] #####"
  if ($Bare) {
    Push-Location $Wd
    & $Bun -e "await import('./$p.mjs')" 2>&1 | ForEach-Object { "$_" }
    Write-Output "exit=$LASTEXITCODE"
    Pop-Location
  } else {
    $acArgs = @('--quiet','--timeout',"$Timeout",'--cwd',$Wd,'--name',$Name)
    if ($Caps) { $acArgs += @('--caps',$Caps) }
    & C:\ac\bin\ac_run.exe @acArgs -- $Bun -e "await import('./$p.mjs')" 2>&1 | ForEach-Object { "$_" }
    Write-Output "exit=$LASTEXITCODE"
  }
}
