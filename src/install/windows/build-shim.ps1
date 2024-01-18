param(
  [switch][bool]$Debug = $False
)

$ErrorActionPreference = 'Stop' # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "..\..\..\scripts\env.ps1")

Push-Location $PSScriptRoot
try {
  $RelaseMode = if ($Debug) { "Debug" } else { "ReleaseFast" }

  rm build -Recurse -ErrorAction SilentlyContinue
  mkdir build
  zig build-obj .\bun_shim.zig -O $RelaseMode -fsingle-threaded `
    -fomit-frame-pointer -fstrip -fno-unwind-tables -fno-sanitize-thread `
    -fno-valgrind -femit-llvm-ir -fno-emit-bin
  clang-cl.exe /c bun_shim.ll /GS- /Gs999999 /O2
  lld-link.exe bun_shim.obj /subsystem:console /stack:0x1000,0x1000 /heap:0x4,0x4 /LTCG /DEBUG `
   'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64\ntdll.lib' 
} finally { Pop-Location }
