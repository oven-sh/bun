param(
  [Alias("o")]$OutDir = "build"
)

$Script=(Join-Path $PSScriptRoot "./cross-compile-codegen.sh")
(Get-Content $Script -Raw).Replace("`r`n","`n") | Set-Content $Script -Force -NoNewline
$Script=(Join-Path $PSScriptRoot "../src/codegen/create_hash_table")
(Get-Content $Script -Raw).Replace("`r`n","`n") | Set-Content $Script -Force -NoNewline

wsl ./scripts/cross-compile-codegen.sh win32 x64 "$OutDir"
