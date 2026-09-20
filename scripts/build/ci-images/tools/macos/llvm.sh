brew install --quiet --formula "llvm@$LLVM_MAJOR"
# llvm@N is keg-only, and `brew link --force` refuses it while N is Homebrew's
# current LLVM ("macOS provides"). scripts/darwin-ci runs a job with only
# Homebrew's bin on PATH, no profile, so the keg's tools are linked there.
keg="$BREW_PREFIX/opt/llvm@$LLVM_MAJOR/bin"
ln -sf "$keg"/* "$BREW_PREFIX/bin/"
add_to_path "$keg"
