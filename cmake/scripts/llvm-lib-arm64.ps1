# Wrapper for llvm-lib that strips conflicting /machine:x64 flag for ARM64 builds
# This is a workaround for CMake 4.1.0 bug where both /machine:ARM64 and /machine:x64 are added

$llvmLib = "C:\Program Files\LLVM\bin\llvm-lib.exe"
$args = $args | Where-Object { $_ -ne "/machine:x64" }
& $llvmLib @args
exit $LASTEXITCODE
