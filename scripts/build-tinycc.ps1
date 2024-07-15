$ErrorActionPreference = 'Stop'  # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "env.ps1")

Push-Location (Join-Path $BUN_DEPS_DIR 'tinycc')
try {
  cd win32
  Run .\build-tcc.bat -clean
  cd ..

  Set-Content -Path config.h -Value @"
#define TCC_VERSION "$(Get-Content VERSION)"
#define TCC_GITHASH "$(git rev-parse --short HEAD)"
#define CONFIG_TCCDIR "$((Get-Location).Path.Replace('\', '/'))"
#define CONFIG_TCC_PREDEFS 1
#ifdef TCC_TARGET_X86_64
#define CONFIG_TCC_CROSSPREFIX "$PX%-"
#endif
"@

  Run clang-cl -DTCC_TARGET_PE -DTCC_TARGET_X86_64 config.h -DC2STR -o c2str.exe conftest.c
  Run .\c2str.exe .\include\tccdefs.h tccdefs_.h

  $Baseline = $env:BUN_DEV_ENV_SET -eq "Baseline=True"

  Run clang-cl @($env:CFLAGS -split ' ') libtcc.c -o tcc.obj "-DTCC_TARGET_PE" "-DTCC_TARGET_X86_64" "-O2" "-W2" "-Zi" "-MD" "-GS-" "-c" "-MT"
  Run llvm-lib "tcc.obj" "-OUT:tcc.lib"

  Copy-Item tcc.obj $BUN_DEPS_OUT_DIR/tcc.lib

  Write-Host "-> tcc.lib"
} finally { Pop-Location }
