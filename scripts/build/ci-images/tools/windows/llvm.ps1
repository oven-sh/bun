Install-Scoop-Package "$LLVM_SCOOP_PACKAGE@$LLVM_VERSION"

$installed = (clang-cl --version | Select-Object -First 1)
if ($installed -notmatch "version $([regex]::Escape($LLVM_VERSION))") { Fail "clang-cl --version is '$installed', expected $LLVM_VERSION" }
