$Script1=(Join-Path $PSScriptRoot "./cross-compile-codegen.sh")
$CrossCompileCodegen=(Get-Content $Script1 -Raw)
$CrossCompileCodegen.Replace("`r`n","`n") | Set-Content $Script1 -Force -NoNewline
$Script2=(Join-Path $PSScriptRoot "../src/codegen/create_hash_table")
$CreateHashTable=(Get-Content $Script2 -Raw)
$CreateHashTable.Replace("`r`n","`n") | Set-Content $Script2 -Force -NoNewline

& 'C:\Program Files\WSL\wsl.exe' ./scripts/cross-compile-codegen.sh win32 x64 "build"

Set-Content $Script1 -Force -NoNewline -Value $CrossCompileCodegen
Set-Content $Script2 -Force -NoNewline -Value $CreateHashTable

# copy into build-release as well
Remove-Item -Path "build-release/codegen" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "build-release/js" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path "build/codegen" -Destination "build-release/codegen" -Recurse -Force
Copy-Item -Path "build/js" -Destination "build-release/js" -Recurse -Force
