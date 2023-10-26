$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")
$CWD = Get-Location

Set-Location $BUN_DEPS_DIR/lol-html/c-api
cargo build --release --target x86_64-pc-windows-msvc
Copy-Item target/x86_64-pc-windows-msvc/release/lolhtml.lib $BUN_DEPS_OUT_DIR
Copy-Item target/x86_64-pc-windows-msvc/release/lolhtml.pdb $BUN_DEPS_OUT_DIR

Set-Location $CWD