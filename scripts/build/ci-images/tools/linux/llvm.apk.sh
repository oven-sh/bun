# Alpine 3.23 stops at LLVM 21; newer majors are in edge/main. `@edge` is a
# tagged repository: apk takes a package from it only when asked for with the
# tag, so musl and libstdc++ stay the release's. llvmN-dev is left out: it
# needs edge's python3.
echo "@edge https://dl-cdn.alpinelinux.org/alpine/edge/main" >> /etc/apk/repositories
apk update
apk add --no-cache --no-interactive --no-progress \
  "llvm$LLVM_MAJOR@edge" "clang$LLVM_MAJOR@edge" "lld$LLVM_MAJOR@edge" scudo-malloc
# llvm-symbolizer, llvm-objcopy and the rest are only versioned in /usr/bin.
add_to_path "/usr/lib/llvm$LLVM_MAJOR/bin"
