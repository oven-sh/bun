param(
  [switch][bool]$Debug = $False
)

$ErrorActionPreference = 'Stop' # Setting strict mode, similar to 'set -euo pipefail' in bash
. (Join-Path $PSScriptRoot "..\..\..\scripts\env.ps1")

Push-Location $PSScriptRoot
try {
  if($Debug) {
    zig build-exe .\bun_shim_debug.zig -O Debug -fsingle-threaded `
      -fomit-frame-pointer -fno-valgrind "-femit-bin=bun_shim_impl.exe"
  } else {
    zig build-obj .\bun_shim_impl.zig -O ReleaseFast -fsingle-threaded `
      -fomit-frame-pointer -fstrip -fno-unwind-tables -fno-sanitize-thread `
      -fno-valgrind -femit-llvm-ir -fno-emit-bin
    if($LASTEXITCODE -ne 0) { break }
    clang-cl.exe /c bun_shim_impl.ll /GS- /Gs999999 /O2
    lld-link.exe bun_shim_impl.obj /subsystem:console /stack:0x20000,0x20000 /heap:0x4,0x4 /LTCG `
      'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64\ntdll.lib' `
      'C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64\kernel32.lib' `

    dumpbin c:\bun\src\install\windows\bun_shim_impl.exe /imports

    ls bun_shim_impl.exe
  }
} finally { Pop-Location }
