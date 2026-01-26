# Wrapper for llvm-lib that strips conflicting /machine:x64 flag for ARM64 builds
# This is a workaround for CMake 4.1.0 bug where both /machine:ARM64 and /machine:x64 are added

# Find llvm-lib.exe - check LLVM_LIB env var, then PATH, then known locations
if ($env:LLVM_LIB) {
    $llvmLib = $env:LLVM_LIB
} elseif (Get-Command llvm-lib.exe -ErrorAction SilentlyContinue) {
    $llvmLib = (Get-Command llvm-lib.exe).Source
} elseif (Test-Path "C:\Program Files\LLVM\bin\llvm-lib.exe") {
    $llvmLib = "C:\Program Files\LLVM\bin\llvm-lib.exe"
} else {
    Write-Error "Cannot find llvm-lib.exe. Set LLVM_LIB environment variable or add LLVM to PATH."
    exit 1
}

$filteredArgs = $args | Where-Object { $_ -ne "/machine:x64" }
& $llvmLib @filteredArgs
exit $LASTEXITCODE
